// 通話の管理。アプリ全体で1つだけ持つ（画面を移動しても、通話が切れないように）。
//   ・着信は、セッション一覧の購読（SessionList と同じクエリ）の中の call から検知する
//   ・通話の状態の変更は、すべてWorker経由（callRequest）
//   ・WebRTCの接続は、通話が connected になってから作る（発信者がoffer、応答した側がanswer）
import type { Timestamp } from 'firebase/firestore'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LIMITS } from '../../shared/limits'
import type { CallState, SessionDoc } from '../../shared/types'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { CallClient, type LinkState } from './callClient'
import { callRequest, fetchIceServers } from './callApi'

type Row = SessionDoc<Timestamp>

/** idle：通話なし ／ incoming：着信中 ／ calling：呼び出し中 ／ connecting：接続中 ／ connected：通話中 ／ reconnecting：再接続中 ／ orphan：画面を開き直したため、音声がつながっていない通話 */
export type CallPhase = 'idle' | 'incoming' | 'calling' | 'connecting' | 'connected' | 'reconnecting' | 'orphan'

type Local = { sessionId: string; callId: string; role: 'caller' | 'callee'; stream: MediaStream }

export type CallCtx = {
	phase: CallPhase
	/** いま着信中・呼び出し中・通話中のセッション */
	sessionId: string | null
	partnerId: string | null
	callStartedAt: Date | null // 通話中の、開始時刻（経過時間の表示用）
	muted: boolean
	hasMic: boolean
	needUnlock: boolean
	route: string
	notice: string | null
	working: boolean
	clearNotice(): void
	start(sessionId: string): Promise<void>
	answer(): Promise<void>
	reject(): Promise<void>
	hangUp(): Promise<void> // 呼び出し中は取り消し、通話中は終了
	toggleMute(): void
	unlock(): void
}

const Ctx = createContext<CallCtx | null>(null)

const ringMs = (LIMITS.ringSeconds + LIMITS.ringGraceSeconds) * 1000

const isFreshRinging = (c: CallState<Timestamp> | null | undefined, now: number) =>
	!!c && c.status === 'ringing' && now - c.startedAt.toMillis() < ringMs

function micErrorMessage(e: unknown): string {
	const name = (e as { name?: string })?.name
	if (name === 'NotAllowedError' || name === 'SecurityError')
		return 'マイクの使用が許可されていません。ブラウザの設定で許可してから、もう一度お試しください'
	if (name === 'NotReadableError') return 'マイクを使えません。ほかのアプリが使っていないか、確認してください'
	return 'マイクを準備できませんでした'
}

async function getMic(): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: 'SecurityError' })
	// マイクが1つもない端末では、取得を試みず、聞くだけで参加する（環境によっては、取得が返ってこないことがあるため）
	try {
		const devices = await navigator.mediaDevices.enumerateDevices()
		if (!devices.some((d) => d.kind === 'audioinput')) return new MediaStream()
	} catch {
		// 調べられなければ、そのまま取得を試みる
	}
	const ask = navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		video: false,
	})
	// 許可の画面に答えないまま、止まってしまった場合の備え
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(Object.assign(new Error('mic timeout'), { name: 'NotAllowedError' })), 20_000)
	)
	try {
		return await Promise.race([ask, timeout])
	} catch (e) {
		if ((e as { name?: string }).name === 'NotFoundError') return new MediaStream() // マイクがない端末は、聞くだけ
		throw e
	}
}

export function CallProvider({ children }: { children: ReactNode }) {
	const { userId } = useAuth()
	const [rows, setRows] = useState<Map<string, Row>>(new Map())
	const [local, setLocal] = useState<Local | null>(null)
	const [link, setLink] = useState<LinkState>('connecting')
	const [muted, setMuted] = useState(false)
	const [needUnlock, setNeedUnlock] = useState(false)
	const [route, setRoute] = useState('')
	const [notice, setNotice] = useState<string | null>(null)
	const [working, setWorking] = useState(false)
	const [tick, setTick] = useState(0) // 時間切れで、再描画するため
	const clientRef = useRef<CallClient | null>(null)
	const makingClient = useRef(false)

	// ---- セッション一覧の購読（着信の検知） ----
	useEffect(() => {
		setRows(new Map())
		if (!userId) return
		return onSnapshot(
			query(collection(db, 'teach_sessions'), where('memberIds', 'array-contains', userId)),
			(snap) => setRows(new Map(snap.docs.map((d) => [d.id, d.data() as Row]))),
			(e) => console.warn('call watcher error', e)
		)
	}, [userId])

	// ---- 現在の通話を、セッション文書から決める ----
	const now = Date.now()
	void tick
	let current: { sessionId: string; s: Row; call: CallState<Timestamp> } | null = null
	for (const [id, s] of rows) {
		const c = s.call
		if (!c || (c.id !== local?.callId && s.status !== 'active')) continue
		const live = c.status === 'connected' ? now - c.lastPingAt.toMillis() < LIMITS.callStaleSeconds * 1000 || c.id === local?.callId : isFreshRinging(c, now)
		if (!live) continue
		if (c.callerId !== userId && c.calleeId !== userId) continue
		// 自分が参加している通話を優先する
		if (!current || c.id === local?.callId) current = { sessionId: id, s, call: c }
	}
	const call = current?.call ?? null
	const partnerId = call ? (call.callerId === userId ? call.calleeId : call.callerId) : null

	let phase: CallPhase = 'idle'
	if (call?.status === 'ringing') phase = call.calleeId === userId ? 'incoming' : 'calling'
	else if (call?.status === 'connected')
		phase = local?.callId === call.id ? (clientRef.current ? (link === 'connected' ? 'connected' : link === 'reconnecting' ? 'reconnecting' : 'connecting') : 'connecting') : 'orphan'
	// 応答した直後（まだ connected が届いていない間）
	if (phase === 'incoming' && local?.callId === call?.id) phase = 'connecting'

	// ---- 後片付け ----
	const teardown = useCallback((message: string | null) => {
		clientRef.current?.close()
		clientRef.current = null
		makingClient.current = false
		setLocal((l) => {
			l?.stream.getTracks().forEach((t) => t.stop())
			return null
		})
		setLink('connecting')
		setMuted(false)
		setNeedUnlock(false)
		setRoute('')
		if (message) setNotice(message)
	}, [])

	// ---- 自分の通話が、相手の操作や時間切れで終わったとき ----
	useEffect(() => {
		if (!local) return
		const s = rows.get(local.sessionId)
		if (!s) return // 一覧の読み込み前
		const c = s.call
		if (c && c.id === local.callId && (c.status === 'ringing' || c.status === 'connected')) return
		if (!c || c.id !== local.callId) return teardown(null)
		const byMe = c.endedBy === userId
		const msg: Record<string, string | null> = {
			rejected: '相手が、通話を断りました',
			missed: '応答がありませんでした',
			canceled: byMe ? null : '発信が取り消されました',
			busy: '相手は通話中です',
			ended: byMe ? null : c.endReason === 'disconnected' ? '通話が切断されました' : '相手が、通話を終了しました',
		}
		teardown(msg[c.status] ?? null)
	}, [rows, local, userId, teardown])

	// ---- 通話が connected になったら、WebRTCの接続を作る ----
	useEffect(() => {
		if (!local || !userId || clientRef.current || makingClient.current) return
		const c = rows.get(local.sessionId)?.call
		if (!c || c.id !== local.callId || c.status !== 'connected') return
		makingClient.current = true
		const partner = c.callerId === userId ? c.calleeId : c.callerId
		fetchIceServers()
			.then(({ iceServers }) => {
				if (makingClient.current === false) return // 準備中に、終わった
				clientRef.current = new CallClient({
					sessionId: local.sessionId,
					callId: local.callId,
					me: userId,
					partnerId: partner,
					offerer: local.role === 'caller',
					iceServers,
					localStream: local.stream,
					onLink: setLink,
					onNeedUnlock: () => setNeedUnlock(true),
					onFailed: () => {
						callRequest(local.sessionId, 'end', { callId: local.callId, reason: 'disconnected' }).catch(() => {})
						teardown('通話が切断されました')
					},
				})
				setLink('connecting')
			})
			.catch(() => {
				makingClient.current = false
				callRequest(local.sessionId, 'end', { callId: local.callId, reason: 'disconnected' }).catch(() => {})
				teardown('通話を開始できませんでした。接続を確認して、もう一度お試しください')
			})
	}, [rows, local, userId, teardown])

	// ---- 通話中：生存の知らせ（放置された通話を、話中の判定から外すため） ----
	const connectedKey = phase === 'connected' || phase === 'reconnecting' || phase === 'connecting' ? (local?.callId ?? null) : null
	useEffect(() => {
		if (!local || !connectedKey || call?.status !== 'connected') return
		const t = setInterval(
			() => callRequest(local.sessionId, 'ping', { callId: local.callId }).catch(() => {}),
			LIMITS.callPingSeconds * 1000
		)
		return () => clearInterval(t)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [connectedKey, call?.status])

	// ---- 通話中：接続の経路の表示（5秒おき） ----
	useEffect(() => {
		if (phase !== 'connected') return
		const t = setInterval(() => void clientRef.current?.describeRoute().then(setRoute), 5000)
		return () => clearInterval(t)
	}, [phase])

	// ---- 呼び出しの時間切れ：どちらの画面からでも、Workerに確定を依頼する ----
	const ringingKey = call?.status === 'ringing' && current ? `${current.sessionId}|${call.id}|${call.startedAt.toMillis()}` : null
	useEffect(() => {
		if (!ringingKey) return
		const [sessionId, callId, startedMs] = ringingKey.split('|')
		let cancelled = false
		let timer: ReturnType<typeof setTimeout>
		const fire = async (retries: number) => {
			if (cancelled) return
			try {
				await callRequest(sessionId, 'timeout', { callId })
			} catch (e) {
				if (e instanceof ApiError && e.code === 'too_early' && retries < 5) timer = setTimeout(() => void fire(retries + 1), 2000)
			}
			setTick((n) => n + 1)
		}
		timer = setTimeout(() => void fire(0), Math.max(0, Number(startedMs) + LIMITS.ringSeconds * 1000 - Date.now()))
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [ringingKey])

	// ---- 着信の知らせ：振動と、可能なら音（iOSでは、自動再生の制限で鳴らないことがある） ----
	const incomingKey = phase === 'incoming' ? call?.id : null
	useEffect(() => {
		if (!incomingKey) return
		let ctx: AudioContext | null = null
		try {
			ctx = new AudioContext()
		} catch {
			// 音は、鳴らさない
		}
		const ring = () => {
			navigator.vibrate?.([400, 200, 400])
			if (ctx && ctx.state === 'running') {
				for (const delay of [0, 0.45]) {
					const osc = ctx.createOscillator()
					const gain = ctx.createGain()
					osc.frequency.value = 880
					gain.gain.value = 0.08
					osc.connect(gain).connect(ctx.destination)
					osc.start(ctx.currentTime + delay)
					osc.stop(ctx.currentTime + delay + 0.3)
				}
			}
		}
		ring()
		const t = setInterval(ring, 2500)
		return () => {
			clearInterval(t)
			navigator.vibrate?.(0)
			void ctx?.close()
		}
	}, [incomingKey])

	// ---- ログアウトなどで、画面を離れるとき ----
	useEffect(() => () => clientRef.current?.close(), [])
	useEffect(() => {
		if (!userId) teardown(null)
	}, [userId, teardown])

	// ---- 操作 ----
	const fail = (e: unknown) => setNotice(e instanceof ApiError ? e.message : micErrorMessage(e))

	const start = useCallback(
		async (sessionId: string) => {
			if (working || local) return
			setWorking(true)
			setNotice(null)
			let stream: MediaStream | null = null
			try {
				stream = await getMic() // 発信ボタンのタップの直後に、許可を求める
				const res = await callRequest(sessionId, 'start')
				if (res.status === 'busy') {
					stream.getTracks().forEach((t) => t.stop())
					setNotice('相手は通話中です。不在着信として、チャットに残しました')
					return
				}
				setLocal({ sessionId, callId: res.callId!, role: 'caller', stream })
			} catch (e) {
				stream?.getTracks().forEach((t) => t.stop())
				fail(e)
			} finally {
				setWorking(false)
			}
		},
		[working, local]
	)

	const answer = useCallback(async () => {
		if (!current || phase !== 'incoming' || working) return
		setWorking(true)
		setNotice(null)
		let stream: MediaStream | null = null
		try {
			stream = await getMic() // 「応答」を押したあとに、許可を求める
			const res = await callRequest(current.sessionId, 'answer', { callId: current.call.id })
			setLocal({ sessionId: current.sessionId, callId: res.callId ?? current.call.id, role: 'callee', stream })
		} catch (e) {
			stream?.getTracks().forEach((t) => t.stop())
			fail(e)
		} finally {
			setWorking(false)
		}
	}, [current, phase, working])

	const reject = useCallback(async () => {
		if (!current || phase !== 'incoming') return
		try {
			await callRequest(current.sessionId, 'reject', { callId: current.call.id })
		} catch (e) {
			fail(e)
		}
	}, [current, phase])

	const hangUp = useCallback(async () => {
		if (!current) return
		const { sessionId, call: c } = current
		const calling = c.status === 'ringing'
		try {
			await callRequest(sessionId, calling ? 'cancel' : 'end', { callId: c.id })
		} catch (e) {
			if (!(e instanceof ApiError && e.code === 'invalid_state')) fail(e)
		}
		if (local?.callId === c.id) teardown(null)
	}, [current, local, teardown])

	const toggleMute = useCallback(() => {
		setMuted((m) => {
			clientRef.current?.setMuted(!m)
			return !m
		})
	}, [])

	const unlock = useCallback(() => {
		clientRef.current?.unlock()
		setNeedUnlock(false)
	}, [])

	const value: CallCtx = {
		phase,
		sessionId: current?.sessionId ?? null,
		partnerId,
		callStartedAt: call?.answeredAt?.toDate() ?? call?.startedAt.toDate() ?? null,
		muted,
		hasMic: (local?.stream.getAudioTracks().length ?? 0) > 0,
		needUnlock,
		route,
		notice,
		working,
		clearNotice: () => setNotice(null),
		start,
		answer,
		reject,
		hangUp,
		toggleMute,
		unlock,
	}
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCall(): CallCtx {
	const v = useContext(Ctx)
	if (!v) throw new Error('CallProvider is missing')
	return v
}

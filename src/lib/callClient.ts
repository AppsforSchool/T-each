// 1対1の音声通話の、WebRTC接続。試作（calltest.html）で動いた仕組みを、Firestoreのシグナリングに移したもの。
//   ・offerを送るのは、発信者だけ。受ける側は、answerを返す
//   ・ICE候補は、相手のremoteDescriptionが設定される前に届くことがあるため、溜めておく
//   ・切断したら、5秒おき・最大6回（30秒）、ICE restartで再接続を試みる。
//     offerを送った側は自分で実行し、受けた側は、相手に「restart」を依頼する
//   ・シグナリング（Firestore）が切れても、通話の接続は切らない
import type { Timestamp } from 'firebase/firestore'
import { addDoc, collection, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { LIMITS } from '../../shared/limits'
import type { SignalDoc } from '../../shared/types'
import { db } from '../firebase'

export type LinkState = 'connecting' | 'connected' | 'reconnecting'

type Options = {
	sessionId: string
	callId: string
	me: string
	partnerId: string
	/** true：発信者（offerを送る側） */
	offerer: boolean
	iceServers: RTCIceServer[]
	localStream: MediaStream
	onLink(state: LinkState): void
	/** 再接続をあきらめた（または、最初の接続ができなかった） */
	onFailed(): void
	/** iOSなどで、音の自動再生がブロックされた。画面に「音を出す」ボタンを出す */
	onNeedUnlock(): void
}

const RESTART_INTERVAL_MS = 5000
const MAX_RESTARTS = Math.round((LIMITS.reconnectSeconds * 1000) / RESTART_INTERVAL_MS)
const FIRST_CONNECT_TIMEOUT_MS = 40_000

export class CallClient {
	private pc: RTCPeerConnection
	private pending: RTCIceCandidateInit[] = []
	private chain: Promise<void> = Promise.resolve()
	private unsubscribe: () => void
	private audio: HTMLAudioElement | null = null
	private restartTimer: ReturnType<typeof setTimeout> | undefined
	private connectTimer: ReturnType<typeof setTimeout> | undefined
	private restartCount = 0
	private closed = false
	private everConnected = false

	constructor(private o: Options) {
		this.pc = new RTCPeerConnection({ iceServers: o.iceServers })

		if (o.localStream.getAudioTracks().length) o.localStream.getTracks().forEach((t) => this.pc.addTrack(t, o.localStream))
		else this.pc.addTransceiver('audio', { direction: 'recvonly' }) // マイクがない端末は、聞くだけ

		this.pc.onicecandidate = (e) => {
			if (e.candidate) void this.send('ice', e.candidate.toJSON())
		}
		this.pc.ontrack = (e) => this.attachAudio(e.streams[0] ?? new MediaStream([e.track]))
		this.pc.onconnectionstatechange = () => this.onConnectionState()

		// 相手が書いた接続情報だけを受け取る
		this.unsubscribe = onSnapshot(
			query(
				collection(db, 'teach_sessions', o.sessionId, 'signals'),
				where('callId', '==', o.callId),
				where('to', '==', o.me)
			),
			(snap) => {
				const added = snap.docChanges().filter((c) => c.type === 'added')
				const docs = added.map((c) => c.doc.data() as SignalDoc<Timestamp>)
				docs.sort((a, b) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity))
				for (const d of docs) this.chain = this.chain.then(() => this.handle(d)).catch((e) => console.warn('signal error', e))
			},
			(e) => console.warn('signals listen error', e)
		)

		window.addEventListener('online', this.onOnline)
		this.connectTimer = setTimeout(() => {
			if (!this.everConnected && !this.closed) o.onFailed()
		}, FIRST_CONNECT_TIMEOUT_MS)

		if (o.offerer) void this.sendOffer(false)
	}

	// ---- 外から使うもの ----
	get hasMic() {
		return this.o.localStream.getAudioTracks().length > 0
	}

	setMuted(muted: boolean) {
		this.o.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted))
	}

	/** 自動再生がブロックされたときに、利用者のタップから呼ぶ */
	unlock() {
		void this.audio?.play().catch(() => this.o.onNeedUnlock())
	}

	/** 接続の経路（host＝同じネットワーク／srflx＝STUN経由／relay＝TURN経由）と往復時間。TURNが必要かの判断に使う */
	async describeRoute(): Promise<string> {
		try {
			const stats = await this.pc.getStats()
			const byId = new Map<string, Record<string, unknown>>()
			stats.forEach((r) => byId.set(r.id, r))
			let pair: Record<string, unknown> | undefined
			stats.forEach((r) => {
				if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId)
			})
			if (!pair) return ''
			const local = byId.get(pair.localCandidateId as string)
			const remote = byId.get(pair.remoteCandidateId as string)
			const rtt = typeof pair.currentRoundTripTime === 'number' ? `${Math.round(pair.currentRoundTripTime * 1000)}ms` : '-'
			return `経路 ${local?.candidateType ?? '?'} ⇄ ${remote?.candidateType ?? '?'}／往復 ${rtt}`
		} catch {
			return ''
		}
	}

	close() {
		if (this.closed) return
		this.closed = true
		clearTimeout(this.restartTimer)
		clearTimeout(this.connectTimer)
		window.removeEventListener('online', this.onOnline)
		this.unsubscribe()
		this.o.localStream.getTracks().forEach((t) => t.stop())
		this.pc.close()
		this.audio?.remove()
		this.audio = null
	}

	// ---- シグナリング ----
	private async send(type: SignalDoc['type'], payload: object) {
		if (this.closed) return
		try {
			await addDoc(collection(db, 'teach_sessions', this.o.sessionId, 'signals'), {
				callId: this.o.callId,
				from: this.o.me,
				to: this.o.partnerId,
				type,
				data: JSON.stringify(payload),
				createdAt: serverTimestamp(),
			})
		} catch (e) {
			console.warn('signal send failed', type, e) // 通話がすでに終わっている場合は、ルールで拒否される
		}
	}

	private async handle(d: SignalDoc<Timestamp>) {
		if (this.closed) return
		const payload = JSON.parse(d.data)
		if (d.type === 'restart') {
			if (this.o.offerer) await this.sendOffer(true)
		} else if (d.type === 'sdp') {
			const sdp = payload as RTCSessionDescriptionInit
			if (sdp.type === 'offer' && !this.o.offerer) {
				await this.pc.setRemoteDescription(sdp)
				await this.flushPending()
				await this.pc.setLocalDescription(await this.pc.createAnswer())
				await this.send('sdp', this.pc.localDescription!.toJSON())
			} else if (sdp.type === 'answer' && this.o.offerer && this.pc.signalingState === 'have-local-offer') {
				await this.pc.setRemoteDescription(sdp)
				await this.flushPending()
			}
		} else if (d.type === 'ice') {
			if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload).catch((e) => console.warn('addIceCandidate', e))
			else this.pending.push(payload)
		}
	}

	private async flushPending() {
		while (this.pending.length) await this.pc.addIceCandidate(this.pending.shift()!).catch((e) => console.warn('addIceCandidate', e))
	}

	private async sendOffer(iceRestart: boolean) {
		try {
			await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart }))
			await this.send('sdp', this.pc.localDescription!.toJSON())
		} catch (e) {
			console.warn('offer failed', e)
		}
	}

	// ---- 接続の状態と、再接続 ----
	private onConnectionState() {
		if (this.closed) return
		const st = this.pc.connectionState
		if (st === 'connected') {
			this.everConnected = true
			clearTimeout(this.restartTimer)
			clearTimeout(this.connectTimer)
			this.restartCount = 0
			this.o.onLink('connected')
		} else if (st === 'disconnected' || st === 'failed') {
			if (this.everConnected) this.o.onLink('reconnecting')
			this.scheduleRestart()
		}
	}

	private async requestRestart() {
		if (this.o.offerer) await this.sendOffer(true)
		else await this.send('restart', {})
	}

	private scheduleRestart() {
		clearTimeout(this.restartTimer)
		this.restartTimer = setTimeout(async () => {
			if (this.closed || this.pc.connectionState === 'connected') return
			if (this.restartCount >= MAX_RESTARTS) {
				this.o.onFailed()
				return
			}
			this.restartCount++
			await this.requestRestart()
			this.scheduleRestart()
		}, RESTART_INTERVAL_MS)
	}

	/** 回線が戻ったら、つながっていないときは、すぐに再接続を試す */
	private onOnline = () => {
		if (this.closed || this.pc.connectionState === 'connected' || !this.everConnected) return
		this.restartCount = 0
		void this.requestRestart()
		this.scheduleRestart()
	}

	private attachAudio(stream: MediaStream) {
		this.audio?.remove()
		const a = document.createElement('audio')
		a.autoplay = true
		a.setAttribute('playsinline', '')
		a.srcObject = stream
		document.body.appendChild(a)
		this.audio = a
		a.play().catch(() => this.o.onNeedUnlock())
	}
}

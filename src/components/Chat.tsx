import {
	collection,
	doc,
	FieldPath,
	limitToLast,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	type Timestamp,
	updateDoc,
} from 'firebase/firestore'
import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '../../shared/limits'
import type { MessageDoc, SystemKind } from '../../shared/types'
import { ApiError, apiFetch } from '../api'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { useUser } from '../lib/users'

type Msg = { id: string; data: MessageDoc<Timestamp> }

const SYSTEM_TEXT: Record<SystemKind, (actor: string) => string> = {
	approved: (a) => `${a}さんが、依頼を承認しました`,
	declined: (a) => `${a}さんが、依頼を断りました`,
	autoDeclined: () => '返答がなかったため、自動的に拒否扱いになりました',
	withdrawn: (a) => `${a}さんが、依頼を取り下げました`,
	ended: (a) => `${a}さんが、セッションを終了しました`,
	autoEnded: () => '一定期間、活動がなかったため、自動的に終了しました',
	resumed: (a) => `${a}さんが、セッションを再開しました`,
	missedCall: () => '不在着信',
	callEnded: () => '通話が終了しました',
	callDisconnected: () => '通話が切断されました',
}

function SystemNote({ m }: { m: MessageDoc<Timestamp> }) {
	const actor = useUser(m.senderId)
	const label = m.kind ? SYSTEM_TEXT[m.kind](actor?.name ?? '…') : ''
	return (
		<div className="chat-system">
			{label}
			{m.text && <span className="chat-system-sub">{m.text}</span>}
		</div>
	)
}

function Bubble({ m, mine }: { m: MessageDoc<Timestamp>; mine: boolean }) {
	const sender = useUser(mine ? null : m.senderId)
	const time = m.createdAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
	return (
		<div className={`chat-row ${mine ? 'mine' : ''}`}>
			<div className="chat-bubble-wrap">
				{!mine && <span className="chat-name">{sender?.name ?? '…'}</span>}
				<div className="chat-bubble">{m.text}</div>
				<span className="chat-time">{time}</span>
			</div>
		</div>
	)
}

/**
 * チャット。メッセージの送信はWorker経由、受信はFirestoreの購読。
 * 画面に表示している間、新着が届いたら、自分の既読時刻（lastRead）を更新する。
 */
export function Chat({
	sessionId,
	myLastRead,
	canSend,
	active = true,
}: {
	sessionId: string
	myLastRead: Timestamp | undefined
	canSend: boolean
	/** チャットが、画面に見えているか。見えている間だけ、既読にする（ボードのタブを見ている間は、既読にしない） */
	active?: boolean
}) {
	const { userId } = useAuth()
	const [msgs, setMsgs] = useState<Msg[] | null>(null)
	const [text, setText] = useState('')
	const [sending, setSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [visibleTick, setVisibleTick] = useState(0)
	const boxRef = useRef<HTMLDivElement>(null)
	const didInitialScroll = useRef(false)
	const lastWrite = useRef(0)

	useEffect(() => {
		return onSnapshot(
			query(collection(db, 'teach_sessions', sessionId, 'messages'), orderBy('createdAt'), limitToLast(LIMITS.chatLoadCount)),
			(snap) => setMsgs(snap.docs.map((d) => ({ id: d.id, data: d.data() as MessageDoc<Timestamp> }))),
			() => setMsgs([])
		)
	}, [sessionId])

	// 新着が来たら、下までスクロールする（読み返している途中なら、動かさない）
	useEffect(() => {
		const box = boxRef.current
		if (!box || !msgs) return
		const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140
		if (nearBottom || !didInitialScroll.current) box.scrollTop = box.scrollHeight
		didInitialScroll.current = true
	}, [msgs])

	useEffect(() => {
		const box = boxRef.current
		if (active && box) box.scrollTop = box.scrollHeight
	}, [active])

	// タブが見える状態に戻ったら、既読を、あらためて判定する
	useEffect(() => {
		const onVisible = () => document.visibilityState === 'visible' && setVisibleTick((n) => n + 1)
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [])

	// 既読：画面を表示している間だけ、数秒に1回まで、自分の分だけを書く
	useEffect(() => {
		if (!active || !msgs || msgs.length === 0 || !userId) return
		const latest = msgs[msgs.length - 1].data.createdAt
		if (myLastRead && myLastRead.toMillis() >= latest.toMillis()) return
		if (document.visibilityState !== 'visible') return
		const wait = Math.max(0, LIMITS.readMarkIntervalMs - (Date.now() - lastWrite.current))
		const t = setTimeout(() => {
			lastWrite.current = Date.now()
			updateDoc(doc(db, 'teach_sessions', sessionId), new FieldPath('lastRead', userId), serverTimestamp()).catch(() => {})
		}, wait)
		return () => clearTimeout(t)
	}, [msgs, myLastRead, sessionId, userId, visibleTick, active])

	const send = async () => {
		const t = text.trim()
		if (!t || sending) return
		setSending(true)
		setError(null)
		try {
			await apiFetch(`/api/sessions/${sessionId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: t }),
			})
			setText('')
		} catch (e) {
			setError(e instanceof ApiError ? e.message : '送信できませんでした')
		} finally {
			setSending(false)
		}
	}

	return (
		<section className="card chat">
			<div className="chat-box" ref={boxRef}>
				{msgs === null && <p className="muted">読み込み中…</p>}
				{msgs && msgs.length === 0 && <p className="muted">まだメッセージはありません。</p>}
				{msgs?.map(({ id, data }) =>
					data.type === 'system' ? (
						<SystemNote key={id} m={data} />
					) : (
						<Bubble key={id} m={data} mine={data.senderId === userId} />
					)
				)}
			</div>
			{canSend ? (
				<div className="chat-input">
					{error && <p className="error">{error}</p>}
					<div className="chat-input-row">
						<textarea
							className="input"
							rows={2}
							value={text}
							maxLength={LIMITS.chatMessageMaxChars}
							placeholder="メッセージ（Ctrl + Enter で送信）"
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
									e.preventDefault()
									send()
								}
							}}
						/>
						<button className="btn" onClick={send} disabled={sending || !text.trim()}>
							送信
						</button>
					</div>
				</div>
			) : (
				<p className="muted chat-readonly">終了しているため、読み取り専用です。書き込むには、セッションを再開してください。</p>
			)}
		</section>
	)
}

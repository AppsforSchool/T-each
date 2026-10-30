import type { Timestamp } from 'firebase/firestore'
import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LIMITS } from '../../shared/limits'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { CallButton } from '../components/CallButton'
import { Icon } from '../components/Icons'
import { Layout } from '../components/Layout'
import { Workspace } from '../components/Workspace'
import { db } from '../firebase'
import { partnerIdOf, runSessionAction, type SessionAction, sessionTitle, statusLabelOf } from '../lib/sessions'
import { useUser } from '../lib/users'

export function SessionPage() {
	const { id } = useParams<{ id: string }>()
	const { userId } = useAuth()
	const [s, setS] = useState<SessionDoc<Timestamp> | null | 'notfound'>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showDecline, setShowDecline] = useState(false)
	const [reason, setReason] = useState('')

	useEffect(() => {
		if (!id) return
		return onSnapshot(
			doc(db, 'teach_sessions', id),
			(snap) => setS(snap.exists() ? (snap.data() as SessionDoc<Timestamp>) : 'notfound'),
			() => setS('notfound') // 参加者でない場合も、ここに来る
		)
	}, [id])

	const partner = useUser(s && s !== 'notfound' ? partnerIdOf(s, userId) : null)

	const run = async (action: SessionAction, body?: object, confirmText?: string) => {
		if (!id) return
		if (confirmText && !window.confirm(confirmText)) return
		setBusy(true)
		setError(null)
		try {
			await runSessionAction(id, action, body)
			setShowDecline(false)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	if (s === null)
		return (
			<Layout sidebar={false}>
				<p className="muted">読み込み中…</p>
			</Layout>
		)
	if (s === 'notfound')
		return (
			<Layout sidebar={false}>
				<div className="card solo">
					<p>セッションが見つかりません。削除されたか、参加者ではありません。</p>
					<p style={{ marginTop: 8 }}>
						<Link to="/requests">依頼一覧へ</Link>
					</p>
				</div>
			</Layout>
		)

	// ボードとチャットを表示するのは、進行中と、承認されたことがある終了中のセッション
	const hasWorkspace = s.status === 'active' || (s.status === 'ended' && !!s.approvedAt)
	const isTutor = s.tutorId === userId
	const isRequester = s.requesterId === userId
	const name = partner?.name ?? '…'
	const partnerRole = isTutor ? '依頼者' : '先生'
	const avatar = partner?.imageUrl ? <img className="avatar sm" src={partner.imageUrl} alt="" /> : <span className="avatar sm" />

	const side = (
		<aside className={`session-side card ${hasWorkspace ? '' : 'solo'}`}>
			<Link to="/requests" className="back-link">
				<Icon name="back" size={18} />
				依頼一覧に戻る
			</Link>

			<div className="side-block">
				<span className={`badge ${s.status}`}>{statusLabelOf(s, userId)}</span>
				<h1 className="side-title">{sessionTitle(s)}</h1>
				<div className="profile-row">
					{avatar}
					<p>
						相手：<b>{name}</b>（{partnerRole}）
					</p>
				</div>
			</div>

			{s.source.imageUrls.length > 0 && (
				<div className="thumbs">
					{s.source.imageUrls.map((u) => (
						<a key={u} className="thumb" href={u} target="_blank" rel="noreferrer">
							<img src={u} alt="" />
						</a>
					))}
				</div>
			)}

			<dl className="meta">
				<div>
					<dt>
						<Icon name="doc" size={16} />
						依頼内容
					</dt>
					<dd>
						{s.source.text ? <span className="pre">{s.source.text}</span> : <span className="muted">（問題文はありません）</span>}
						{s.source.comment && (
							<span className="pre meta-comment">
								<span className="muted">コメント：</span>
								{s.source.comment}
							</span>
						)}
					</dd>
				</div>
				<div>
					<dt>
						<Icon name="clock" size={16} />
						{s.approvedAt ? '開始時刻' : '依頼日時'}
					</dt>
					<dd>{(s.approvedAt ?? s.createdAt).toDate().toLocaleString('ja-JP')}</dd>
				</div>
			</dl>

			{s.status === 'active' && (
				<div className="side-call">
					<CallButton sessionId={id!} />
				</div>
			)}
			{s.status === 'requested' && isTutor && <p className="notice">{name}さんから、依頼が届いています。</p>}
			{s.status === 'requested' && isRequester && <p className="notice">{name}さんの返答を、待っています。</p>}
			{s.status === 'declined' && (
				<p className="notice">
					{s.autoDeclined ? '返答がなかったため、自動的に拒否扱いになりました。' : isTutor ? 'あなたが、断りました。' : `${name}さんに、断られました。`}
					{s.declineReason && <span className="quote">理由：{s.declineReason}</span>}
				</p>
			)}
			{s.status === 'ended' && (
				<p className="notice">
					{s.autoEnded ? '一定期間、活動がなかったため、自動的に終了しました。' : s.endedBy === userId ? 'あなたが、終了しました。' : `${name}さんが、終了しました。`}
				</p>
			)}
			{s.deleteAt && <p className="muted">{s.deleteAt.toDate().toLocaleDateString('ja-JP')} に削除されます。</p>}

			{error && <p className="error">{error}</p>}

			{s.status === 'requested' && isTutor && !showDecline && (
				<div className="side-actions">
					<button className="btn" disabled={busy} onClick={() => run('approve')}>
						承認する
					</button>
					<button className="btn ghost" disabled={busy} onClick={() => setShowDecline(true)}>
						断る
					</button>
				</div>
			)}
			{s.status === 'requested' && isTutor && showDecline && (
				<div className="form">
					<label>
						<span className="label">断る理由（任意）</span>
						<textarea
							className="input"
							rows={3}
							value={reason}
							maxLength={LIMITS.declineReasonMaxChars}
							onChange={(e) => setReason(e.target.value)}
							placeholder="例：自分には教えられない／教えるのが難しい／忙しい"
						/>
					</label>
					<div className="side-actions">
						<button className="btn" disabled={busy} onClick={() => run('decline', { reason })}>
							断る
						</button>
						<button className="btn ghost" disabled={busy} onClick={() => setShowDecline(false)}>
							戻る
						</button>
					</div>
				</div>
			)}
			{s.status === 'requested' && isRequester && (
				<div className="side-actions">
					<button className="btn ghost" disabled={busy} onClick={() => run('withdraw', {}, 'この依頼を取り下げますか？')}>
						取り下げる
					</button>
				</div>
			)}
			{s.status === 'active' &&
				(isRequester ? (
					<button
						className="btn danger-outline"
						disabled={busy}
						onClick={() => run('end', {}, 'このセッションを終了しますか？（あとで再開できます）')}
					>
						セッションを終了
					</button>
				) : (
					<p className="muted">終了できるのは、依頼した側だけです。</p>
				))}
			{s.status === 'ended' && s.approvedAt && (
				<button className="btn" disabled={busy} onClick={() => run('resume')}>
					再開する
				</button>
			)}
			{(s.status === 'declined' || (s.status === 'ended' && !s.approvedAt)) && (
				<p className="muted">この依頼は、再開できません。必要なら、新しく依頼してください。</p>
			)}
		</aside>
	)

	if (!hasWorkspace) return <Layout sidebar={false}>{side}</Layout>

	return (
		<Layout sidebar={false} wide>
			<div className="session-grid">
				{side}
				{s.status === 'active' && (
					<div className="session-topbar card">
						{avatar}
						<div className="session-topbar-text">
							<b>{name}</b>
							<span className="muted">{partnerRole}</span>
						</div>
						<CallButton sessionId={id!} />
					</div>
				)}
				<Workspace sessionId={id!} s={s} />
			</div>
		</Layout>
	)
}

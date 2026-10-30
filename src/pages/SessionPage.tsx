import type { Timestamp } from 'firebase/firestore'
import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LIMITS } from '../../shared/limits'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { CallButton } from '../components/CallButton'
import { Header } from '../components/Header'
import { Workspace } from '../components/Workspace'
import { db } from '../firebase'
import { partnerIdOf, roleLabelOf, runSessionAction, type SessionAction, STATUS_LABEL } from '../lib/sessions'
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
			<>
				<Header />
				<main className="page">
					<p className="muted">読み込み中…</p>
				</main>
			</>
		)
	if (s === 'notfound')
		return (
			<>
				<Header />
				<main className="page">
					<div className="card">
						<p>セッションが見つかりません。削除されたか、参加者ではありません。</p>
						<p style={{ marginTop: 8 }}>
							<Link to="/">ホームへ</Link>
						</p>
					</div>
				</main>
			</>
		)

	// ボードとチャットを表示するのは、進行中と、承認されたことがある終了中のセッション
	const hasWorkspace = s.status === 'active' || (s.status === 'ended' && !!s.approvedAt)
	const isTutor = s.tutorId === userId
	const isRequester = s.requesterId === userId
	const name = partner?.name ?? '…'

	return (
		<>
			<Header />
			<main className={`page ${hasWorkspace ? 'page-wide' : ''}`}>
				<section className="card">
					<div className="profile-row">
						{partner?.imageUrl ? <img className="avatar" src={partner.imageUrl} alt="" /> : <div className="avatar" />}
						<div>
							<b>{name}</b> <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status]}</span>
							<p className="muted">
								あなたは「{roleLabelOf(s, userId)}」側 ／ 依頼日 {s.createdAt.toDate().toLocaleString('ja-JP')}
							</p>
						</div>
					</div>

					{s.status === 'active' && (
						<p className="actions" style={{ marginTop: 10 }}>
							<CallButton sessionId={id!} />
						</p>
					)}
					{s.status === 'requested' && isTutor && <p style={{ marginTop: 10 }}>{name}さんから、依頼が届いています。</p>}
					{s.status === 'requested' && isRequester && <p style={{ marginTop: 10 }}>{name}さんの返答を、待っています。</p>}
					{s.status === 'declined' && (
						<p style={{ marginTop: 10 }}>
							{s.autoDeclined
								? '返答がなかったため、自動的に拒否扱いになりました。'
								: isTutor
									? 'あなたが、断りました。'
									: `${name}さんに、断られました。`}
							{s.declineReason && <span className="quote">理由：{s.declineReason}</span>}
						</p>
					)}
					{s.status === 'ended' && (
						<p style={{ marginTop: 10 }}>
							{s.autoEnded
								? '一定期間、活動がなかったため、自動的に終了しました。'
								: s.endedBy === userId
									? 'あなたが、終了しました。'
									: `${name}さんが、終了しました。`}
						</p>
					)}
					{s.deleteAt && (
						<p className="muted">{s.deleteAt.toDate().toLocaleDateString('ja-JP')} に削除されます。</p>
					)}
				</section>

				<section className="card">
					<h2>依頼の内容</h2>
					{s.source.text ? <p className="pre">{s.source.text}</p> : <p className="muted">（問題文はありません）</p>}
					{s.source.comment && (
						<p className="pre" style={{ marginTop: 8 }}>
							<span className="muted">コメント：</span>
							{s.source.comment}
						</p>
					)}
					{s.source.imageUrls.length > 0 && (
						<div className="thumbs">
							{s.source.imageUrls.map((u) => (
								<a key={u} className="thumb" href={u} target="_blank" rel="noreferrer">
									<img src={u} alt="" />
								</a>
							))}
						</div>
					)}
				</section>

				{hasWorkspace && <Workspace sessionId={id!} s={s} />}

				<section className="card">
					<h2>操作</h2>
					{error && <p className="error">{error}</p>}

					{s.status === 'requested' && isTutor && !showDecline && (
						<p className="actions">
							<button className="btn" disabled={busy} onClick={() => run('approve')}>
								承認する
							</button>
							<button className="btn ghost" disabled={busy} onClick={() => setShowDecline(true)}>
								断る
							</button>
						</p>
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
							<p className="actions">
								<button className="btn" disabled={busy} onClick={() => run('decline', { reason })}>
									断る
								</button>
								<button className="btn ghost" disabled={busy} onClick={() => setShowDecline(false)}>
									戻る
								</button>
							</p>
						</div>
					)}
					{s.status === 'requested' && isRequester && (
						<p className="actions">
							<button
								className="btn ghost"
								disabled={busy}
								onClick={() => run('withdraw', {}, 'この依頼を取り下げますか？')}
							>
								取り下げる
							</button>
						</p>
					)}
					{s.status === 'active' && (
						<>
							{isRequester ? (
								<p className="actions">
									<button
										className="btn ghost"
										disabled={busy}
										onClick={() => run('end', {}, 'このセッションを終了しますか？（あとで再開できます）')}
									>
										終了する
									</button>
								</p>
							) : (
								<p className="muted">終了できるのは、依頼した側だけです。</p>
							)}
						</>
					)}
					{s.status === 'ended' && s.approvedAt && (
						<p className="actions">
							<button className="btn" disabled={busy} onClick={() => run('resume')}>
								再開する
							</button>
						</p>
					)}
					{(s.status === 'declined' || (s.status === 'ended' && !s.approvedAt)) && (
						<p className="muted">この依頼は、再開できません。必要なら、新しく依頼してください。</p>
					)}
				</section>

				<p>
					<Link to="/">← ホームへ</Link>
				</p>
			</main>
		</>
	)
}

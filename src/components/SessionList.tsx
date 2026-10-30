import type { Timestamp } from 'firebase/firestore'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { partnerIdOf, roleLabelOf, runSessionAction, STATUS_LABEL } from '../lib/sessions'
import { useUser } from '../lib/users'

type Row = { id: string; data: SessionDoc<Timestamp> }

const byCreated = (a: Row, b: Row) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis()
const byActivity = (a: Row, b: Row) => b.data.lastActivityAt.toMillis() - a.data.lastActivityAt.toMillis()

function SessionRow({ row, showResume }: { row: Row; showResume?: boolean }) {
	const { userId } = useAuth()
	const navigate = useNavigate()
	const { data } = row
	const partner = useUser(partnerIdOf(data, userId))
	const [busy, setBusy] = useState(false)
	// 相手が最後にメッセージを送っていて、自分の既読より新しければ「新着」。古いデータには lastMessageBy が無い
	const myRead = userId ? data.lastRead?.[userId] : undefined
	const unread =
		!!data.lastMessageBy &&
		data.lastMessageBy !== userId &&
		!!data.lastMessageAt &&
		(!myRead || data.lastMessageAt.toMillis() > myRead.toMillis())

	const resume = async (e: React.MouseEvent) => {
		e.stopPropagation()
		setBusy(true)
		try {
			await runSessionAction(row.id, 'resume')
		} catch (err) {
			window.alert((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="user-row clickable" onClick={() => navigate(`/s/${row.id}`)}>
			{partner?.imageUrl ? <img className="avatar" src={partner.imageUrl} alt="" /> : <div className="avatar" />}
			<div className="user-row-text" style={{ flex: 1 }}>
				<b>
					{partner?.name ?? '…'} <span className={`badge ${data.status}`}>{STATUS_LABEL[data.status]}</span>{' '}
					{unread && <span className="badge new">新着</span>}{' '}
					<span className="muted">（{roleLabelOf(data, userId)}）</span>
				</b>
				<p className="muted clamp">
					{data.source.text || '（画像のみ）'}
					{data.source.imageUrls.length > 0 && `　画像${data.source.imageUrls.length}枚`}
				</p>
				{data.deleteAt && (
					<p className="muted">{data.deleteAt.toDate().toLocaleDateString('ja-JP')} に削除されます</p>
				)}
			</div>
			{showResume && data.approvedAt && (
				<button className="btn small ghost" onClick={resume} disabled={busy}>
					再開
				</button>
			)}
		</div>
	)
}

function Section({ title, rows, showResume }: { title: ReactNode; rows: Row[]; showResume?: boolean }) {
	if (rows.length === 0) return null
	return (
		<section className="card">
			<h2>
				{title} <span className="muted">{rows.length}</span>
			</h2>
			{rows.map((r) => (
				<SessionRow key={r.id} row={r} showResume={showResume} />
			))}
		</section>
	)
}

// セッションの一覧。状態ごとに、セクションを分ける。リアルタイムに更新される。
export function SessionList() {
	const { userId } = useAuth()
	const [rows, setRows] = useState<Row[] | null>(null)
	const [error, setError] = useState(false)

	useEffect(() => {
		if (!userId) return
		// ★ ルールの都合で、必ず memberIds の条件を付ける。並べ替えは、画面側で行う（インデックスを増やさないため）
		return onSnapshot(
			query(collection(db, 'teach_sessions'), where('memberIds', 'array-contains', userId)),
			(snap) => setRows(snap.docs.map((d) => ({ id: d.id, data: d.data() as SessionDoc<Timestamp> }))),
			() => setError(true)
		)
	}, [userId])

	if (error) return <p className="error">セッションを読み込めませんでした。</p>
	if (rows === null) return <p className="muted">読み込み中…</p>
	if (rows.length === 0)
		return (
			<section className="card">
				<p className="muted">まだ依頼はありません。「ユーザー」から、依頼を送れます。</p>
			</section>
		)

	const needsAction = rows.filter((r) => r.data.status === 'requested' && r.data.tutorId === userId).sort(byCreated)
	const active = rows.filter((r) => r.data.status === 'active').sort(byActivity)
	const waiting = rows.filter((r) => r.data.status === 'requested' && r.data.requesterId === userId).sort(byCreated)
	const closed = rows.filter((r) => r.data.status === 'ended' || r.data.status === 'declined').sort(byCreated)

	return (
		<>
			<Section title="要対応（承認待ち）" rows={needsAction} />
			<Section title="進行中" rows={active} />
			<Section title="返答待ち" rows={waiting} />
			<Section title="終了・拒否" rows={closed} showResume />
		</>
	)
}

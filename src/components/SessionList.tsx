import type { Timestamp } from 'firebase/firestore'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { partnerIdOf, roleLabelOf, runSessionAction, sessionTitle, statusLabelOf } from '../lib/sessions'
import { useUser } from '../lib/users'
import { Icon } from './Icons'

export type Row = { id: string; data: SessionDoc<Timestamp> }
export type SessionTab = 'all' | 'pending' | 'active' | 'closed'

const byCreated = (a: Row, b: Row) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis()
const byActivity = (a: Row, b: Row) => b.data.lastActivityAt.toMillis() - a.data.lastActivityAt.toMillis()

/** 自分が関わるセッションを、リアルタイムに取得する */
export function useSessions(): { rows: Row[] | null; error: boolean } {
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
	return { rows, error }
}

export const isPending = (r: Row) => r.data.status === 'requested'
export const isClosed = (r: Row) => r.data.status === 'ended' || r.data.status === 'declined'

export function filterRows(rows: Row[], tab: SessionTab): Row[] {
	switch (tab) {
		case 'pending':
			return rows.filter(isPending).sort(byCreated)
		case 'active':
			return rows.filter((r) => r.data.status === 'active').sort(byActivity)
		case 'closed':
			return rows.filter(isClosed).sort(byCreated)
		default: {
			// すべて：返答待ち・要対応 → 進行中 → 終了 の順（同じ状態の中では、最近動きがあった順）
			const rank = (r: Row) => (r.data.status === 'requested' ? 0 : r.data.status === 'active' ? 1 : 2)
			return [...rows].sort((a, b) => rank(a) - rank(b) || byActivity(a, b))
		}
	}
}

function SessionRow({ row }: { row: Row }) {
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
	const thumb = data.source.imageUrls[0]

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
		<div
			className="req-row"
			role="link"
			tabIndex={0}
			onClick={() => navigate(`/s/${row.id}`)}
			onKeyDown={(e) => e.key === 'Enter' && navigate(`/s/${row.id}`)}
		>
			{thumb ? (
				<img className="req-thumb" src={thumb} alt="" />
			) : partner?.imageUrl ? (
				<img className="req-thumb round" src={partner.imageUrl} alt="" />
			) : (
				<div className="req-thumb round" />
			)}
			<div className="req-main">
				<b className="req-title clamp1">{sessionTitle(data)}</b>
				<p className="muted clamp1">
					{partner?.name ?? '…'}（{roleLabelOf(data, userId)}）　{data.createdAt.toDate().toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
				</p>
				{data.deleteAt && <p className="muted">{data.deleteAt.toDate().toLocaleDateString('ja-JP')} に削除されます</p>}
			</div>
			<div className="req-side">
				{unread && <span className="badge new">新着</span>}
				<span className={`badge ${data.status}`}>{statusLabelOf(data, userId)}</span>
				{data.status === 'ended' && data.approvedAt && (
					<button className="btn small ghost" onClick={resume} disabled={busy}>
						再開
					</button>
				)}
			</div>
			<span className="req-chevron">
				<Icon name="chevron" size={18} />
			</span>
		</div>
	)
}

/** セッションの行を、カードにまとめて並べる */
export function SessionRows({ rows, empty }: { rows: Row[]; empty: string }) {
	if (rows.length === 0)
		return (
			<div className="card empty">
				<p className="muted">{empty}</p>
			</div>
		)
	return (
		<div className="card list-card">
			{rows.map((r) => (
				<SessionRow key={r.id} row={r} />
			))}
		</div>
	)
}

/** ホームに出す、「いま対応が必要なもの」と「進行中」 */
export function HomeSessions() {
	const { userId } = useAuth()
	const { rows, error } = useSessions()
	if (error) return <p className="error">セッションを読み込めませんでした。</p>
	if (rows === null) return <p className="muted">読み込み中…</p>
	const needs = rows.filter((r) => r.data.status === 'requested' && r.data.tutorId === userId).sort(byCreated)
	const active = rows.filter((r) => r.data.status === 'active').sort(byActivity)
	if (needs.length + active.length === 0) return null
	return (
		<>
			{needs.length > 0 && (
				<section className="block">
					<h2 className="block-title">要対応（承認待ち）</h2>
					<SessionRows rows={needs} empty="" />
				</section>
			)}
			{active.length > 0 && (
				<section className="block">
					<h2 className="block-title">進行中</h2>
					<SessionRows rows={active} empty="" />
				</section>
			)}
		</>
	)
}

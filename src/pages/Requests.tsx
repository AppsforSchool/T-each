import { useState } from 'react'
import { Layout } from '../components/Layout'
import { filterRows, isClosed, isPending, SessionRows, type SessionTab, useSessions } from '../components/SessionList'

const TABS: { id: SessionTab; label: string }[] = [
	{ id: 'all', label: 'すべて' },
	{ id: 'pending', label: '承認待ち' },
	{ id: 'active', label: '進行中' },
	{ id: 'closed', label: '終了' },
]

const EMPTY: Record<SessionTab, string> = {
	all: 'まだ依頼はありません。「ユーザー」から、依頼を送れます。',
	pending: '承認待ちの依頼は、ありません。',
	active: '進行中のセッションは、ありません。',
	closed: '終了した依頼は、ありません。',
}

// 依頼一覧：自分が関わる依頼・セッションを、状態で絞り込んで見る
export function Requests() {
	const { rows, error } = useSessions()
	const [tab, setTab] = useState<SessionTab>('all')

	const count = (t: SessionTab) =>
		!rows ? 0 : t === 'all' ? rows.length : t === 'pending' ? rows.filter(isPending).length : t === 'active' ? rows.filter((r) => r.data.status === 'active').length : rows.filter(isClosed).length

	return (
		<Layout>
			<h1 className="page-title">依頼一覧</h1>
			<div className="tabs" role="tablist">
				{TABS.map((t) => (
					<button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
						{t.label}
						{rows && <span className="tab-count">{count(t.id)}</span>}
					</button>
				))}
			</div>
			{error && <p className="error">セッションを読み込めませんでした。</p>}
			{!error && rows === null && <p className="muted">読み込み中…</p>}
			{rows && <SessionRows rows={filterRows(rows, tab)} empty={EMPTY[tab]} />}
		</Layout>
	)
}

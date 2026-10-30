import { collection, getDocs } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Icon } from '../components/Icons'
import { Layout } from '../components/Layout'
import { db } from '../firebase'
import { hedged } from '../lib/hedged'

type UserRow = { id: string; name: string; imageUrl?: string; profileText?: string }

// ユーザー一覧。依頼の相手を選ぶ画面の土台（依頼の作成は、次の段階で追加する）。
// 表示するのは、名前・アイコン・プロフィール文だけ（users_random は、ログインなしでも読める状態のため）。
export function Users() {
	const { userId } = useAuth()
	const [users, setUsers] = useState<UserRow[] | null>(null)
	const [error, setError] = useState(false)
	const [query, setQuery] = useState('')
	const navigate = useNavigate()

	useEffect(() => {
		hedged(() => getDocs(collection(db, 'users_random')))
			.then((snap) =>
				setUsers(
					snap.docs
						.map((d) => {
							const x = d.data()
							return {
								id: d.id,
								name: typeof x.name === 'string' && x.name ? x.name : d.id,
								imageUrl: typeof x.imageUrl === 'string' ? x.imageUrl : undefined,
								profileText: typeof x.profileText === 'string' ? x.profileText : undefined,
							}
						})
						.filter((u) => u.id !== userId) // 自分自身は、依頼先にできない
						.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
				)
			)
			.catch(() => setError(true))
	}, [userId])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!users || !q) return users
		return users.filter((u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
	}, [users, query])

	return (
		<Layout>
			<h1 className="page-title">ユーザー一覧</h1>
			<label className="search">
				<Icon name="search" size={18} />
				<input placeholder="ユーザー名で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
			</label>
			{error && <p className="error">ユーザーの一覧を読み込めませんでした。</p>}
			{!error && filtered === null && <p className="muted">読み込み中…</p>}
			{filtered && filtered.length === 0 && <p className="muted">該当するユーザーがいません。</p>}
			{filtered && filtered.length > 0 && (
				<div className="card list-card">
					{filtered.map((u) => (
						<div className="user-row" key={u.id}>
							{u.imageUrl ? <img className="avatar" src={u.imageUrl} alt="" /> : <div className="avatar" />}
							<div className="user-row-text" style={{ flex: 1 }}>
								<b>{u.name}</b>
								{u.profileText && <p className="muted clamp">{u.profileText}</p>}
							</div>
							<button className="btn small" onClick={() => navigate(`/new?tutor=${encodeURIComponent(u.id)}`)}>
								依頼する
							</button>
						</div>
					))}
				</div>
			)}
		</Layout>
	)
}

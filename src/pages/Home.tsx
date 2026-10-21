import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Header } from '../components/Header'
import { SessionList } from '../components/SessionList'
import { API_BASE } from '../config'
import { db } from '../firebase'
import { hedged } from '../lib/hedged'

type Profile = { name?: string; profileText?: string; imageUrl?: string; isAdmin?: boolean; [k: string]: unknown }

// M1の確認用の画面。ここから、ユーザー一覧・依頼・セッション一覧に育てていく。
export function Home() {
	const { user, userId } = useAuth()
	const [profile, setProfile] = useState<Profile | null | 'error'>(null)
	const [apiResult, setApiResult] = useState<string>('')
	const [fsResult, setFsResult] = useState<string>('')

	useEffect(() => {
		if (!userId) return
		hedged(() => getDoc(doc(db, 'users_random', userId)))
			.then((s) => setProfile(s.exists() ? (s.data() as Profile) : {}))
			.catch(() => setProfile('error'))
	}, [userId])

	const checkApi = async () => {
		setApiResult('確認中…')
		try {
			const token = await user!.getIdToken()
			const res = await fetch(`${API_BASE}/api/whoami`, { headers: { Authorization: `Bearer ${token}` } })
			setApiResult(`HTTP ${res.status}\n${await res.text()}`)
		} catch (e) {
			setApiResult('エラー: ' + (e as Error).message)
		}
	}

	const checkFirestore = async () => {
		setFsResult('確認中…')
		try {
			const token = await user!.getIdToken()
			const res = await fetch(`${API_BASE}/api/dev/firestore-check`, { headers: { Authorization: `Bearer ${token}` } })
			setFsResult(`HTTP ${res.status}\n${await res.text()}`)
		} catch (e) {
			setFsResult('エラー: ' + (e as Error).message)
		}
	}

	return (
		<>
			<Header />
			<main className="page">
				<SessionList />
				<section className="card">
					<h2>自分の情報（users_random）</h2>
					{profile === null && <p className="muted">読み込み中…</p>}
					{profile === 'error' && <p className="error">読み取れませんでした。</p>}
					{profile && profile !== 'error' && (
						<>
							<div className="profile-row">
								{profile.imageUrl ? (
									<img className="avatar" src={profile.imageUrl} alt="" />
								) : (
									<div className="avatar" />
								)}
								<div>
									<b>{profile.name ?? '(名前なし)'}</b>
									{profile.isAdmin && <span className="muted"> ・管理者</span>}
									<p className="muted">{profile.profileText ?? ''}</p>
								</div>
							</div>
							<details>
								<summary className="muted" style={{ marginTop: 8 }}>
									項目の一覧（確認用）
								</summary>
								<pre className="debug">{JSON.stringify(Object.keys(profile).sort(), null, 1)}</pre>
							</details>
						</>
					)}
				</section>

				<section className="card">
					<h2>Workerによるログインの検証</h2>
					<p className="muted">接続先: {API_BASE}</p>
					<p style={{ marginTop: 8 }}>
						<button className="btn" onClick={checkApi}>
							Workerに確認する
						</button>
					</p>
					{apiResult && <pre className="debug">{apiResult}</pre>}
				</section>
				<section className="card">
					<h2>WorkerからFirestoreへの書き込み（M2.1の確認）</h2>
					<p className="muted">teach_dev に自分のIDで1件書いて、読み取って、削除します。</p>
					<p style={{ marginTop: 8 }}>
						<button className="btn" onClick={checkFirestore}>
							Firestoreの書き込みを確認する
						</button>
					</p>
					{fsResult && <pre className="debug">{fsResult}</pre>}
				</section>
			</main>
		</>
	)
}

import { useState } from 'react'
import { useAuth } from '../auth'
import { Logo } from '../components/Header'

export function Login() {
	const { login } = useAuth()
	const [id, setId] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		setBusy(true)
		setError(null)
		try {
			await login(id, password)
		} catch (e) {
			setError('ログインできませんでした（' + ((e as { code?: string }).code ?? '不明なエラー') + '）')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="login-wrap">
			<div className="card login-card">
				<div>
					<Logo />
				</div>
				<p className="muted">既存のサイトと同じIDとパスワードでログインします。</p>
				<input
					className="input"
					placeholder="ID"
					value={id}
					onChange={(e) => setId(e.target.value)}
					autoCapitalize="off"
					autoCorrect="off"
				/>
				<input
					className="input"
					placeholder="パスワード"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && id && password && submit()}
				/>
				<button className="btn" onClick={submit} disabled={busy || !id || !password}>
					{busy ? 'ログイン中…' : 'ログイン'}
				</button>
				{error && <p className="error">{error}</p>}
			</div>
		</div>
	)
}

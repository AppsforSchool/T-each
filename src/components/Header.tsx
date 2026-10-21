import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth'

export function Logo() {
	return (
		<span className="logo">
			T-<span className="logo-each">each</span>
		</span>
	)
}

export function Header() {
	const { userId, logout } = useAuth()
	return (
		<header className="app-header">
			<div className="title-area">
				<Logo />
				<nav className="nav">
					<NavLink to="/" end>
						ホーム
					</NavLink>
					<NavLink to="/users">ユーザー</NavLink>
				</nav>
			</div>
			<div className="user-data">
				<span className="user-name">{userId}</span>
				<button className="btn ghost small" onClick={logout}>
					ログアウト
				</button>
			</div>
		</header>
	)
}

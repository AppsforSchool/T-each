import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useUser } from '../lib/users'
import { Icon, type IconName } from './Icons'

export function Logo() {
	return (
		<span className="logo">
			<svg className="logo-mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M12 2.5a7 7 0 0 0-7 7c0 4.9 7 12 7 12s7-7.1 7-12a7 7 0 0 0-7-7Z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinejoin="round"
				/>
				<circle cx="12" cy="9.5" r="2.6" fill="currentColor" />
			</svg>
			<span className="logo-text">
				T-<span className="logo-each">each</span>
			</span>
		</span>
	)
}

/** 画面上部と下部（スマートフォン）の、移動先 */
const NAV: { to: string; label: string; icon: IconName; end?: boolean; also?: string[] }[] = [
	{ to: '/', label: 'ホーム', icon: 'home', end: true },
	{ to: '/requests', label: '依頼', icon: 'list', also: ['/s/'] },
	{ to: '/users', label: 'ユーザー', icon: 'users', also: ['/new'] },
]

function useActive() {
	const { pathname } = useLocation()
	return (item: (typeof NAV)[number]) =>
		item.end ? pathname === item.to : pathname.startsWith(item.to) || !!item.also?.some((p) => pathname.startsWith(p))
}

function UserMenu() {
	const { userId, logout } = useAuth()
	const me = useUser(userId)
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const close = (e: Event) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', close)
		return () => document.removeEventListener('pointerdown', close)
	}, [open])

	return (
		<div className="user-menu" ref={ref}>
			<button className="user-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				{me?.imageUrl ? <img className="avatar xs" src={me.imageUrl} alt="" /> : <span className="avatar xs" />}
				<span className="user-name">{me?.name ?? userId}</span>
				<Icon name="chevronDown" size={16} />
			</button>
			{open && (
				<div className="menu" role="menu">
					<button role="menuitem" onClick={logout}>
						<Icon name="logout" size={18} />
						ログアウト
					</button>
				</div>
			)}
		</div>
	)
}

export function Header() {
	const isActive = useActive()
	return (
		<header className="app-header">
			<div className="title-area">
				<NavLink to="/" className="logo-link" aria-label="ホーム">
					<Logo />
				</NavLink>
				<nav className="nav" aria-label="メイン">
					{NAV.map((n) => (
						<NavLink key={n.to} to={n.to} end={n.end} className={isActive(n) ? 'active' : ''}>
							<Icon name={n.icon} size={18} />
							{n.label}
						</NavLink>
					))}
				</nav>
			</div>
			<UserMenu />
		</header>
	)
}

/** パソコン・タブレットの、左のメニュー */
export function Sidebar() {
	const { pathname } = useLocation()
	const items: { to: string; label: string; icon: IconName; on: boolean }[] = [
		{ to: '/', label: 'ホーム', icon: 'home', on: pathname === '/' },
		{ to: '/users', label: '依頼する', icon: 'plus', on: pathname === '/new' },
		{ to: '/requests', label: '依頼一覧', icon: 'list', on: pathname.startsWith('/requests') },
		{ to: '/users', label: 'ユーザー', icon: 'users', on: pathname === '/users' },
	]
	return (
		<aside className="sidebar">
			<nav aria-label="サイドメニュー">
				{items.map((i) => (
					<NavLink key={i.label} to={i.to} className={i.on ? 'active' : ''}>
						<Icon name={i.icon} size={19} />
						{i.label}
					</NavLink>
				))}
			</nav>
		</aside>
	)
}

/** スマートフォンの、下のメニュー */
export function BottomNav() {
	const isActive = useActive()
	return (
		<nav className="bottom-nav" aria-label="メイン">
			{NAV.map((n) => (
				<NavLink key={n.to} to={n.to} end={n.end} className={isActive(n) ? 'active' : ''}>
					<Icon name={n.icon} size={22} />
					<span>{n.label}</span>
				</NavLink>
			))}
		</nav>
	)
}

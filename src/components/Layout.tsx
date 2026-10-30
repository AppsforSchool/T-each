import type { ReactNode } from 'react'
import { BottomNav, Header, Sidebar } from './Header'

/** どの画面でも共通の枠。上のヘッダー、（広い画面では）左のメニュー、（スマートフォンでは）下のメニュー。 */
export function Layout({ children, sidebar = true, wide = false }: { children: ReactNode; sidebar?: boolean; wide?: boolean }) {
	return (
		<>
			<Header />
			<div className={`shell ${sidebar ? 'with-side' : ''}`}>
				{sidebar && <Sidebar />}
				<main className={`content ${wide ? 'content-wide' : ''}`}>{children}</main>
			</div>
			<BottomNav />
		</>
	)
}

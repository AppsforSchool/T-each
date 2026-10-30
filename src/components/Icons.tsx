import type { ReactNode } from 'react'

// 画面で使う線画のアイコン（外部のライブラリを使わず、必要なものだけ自前で持つ）
const PATHS = {
	home: (
		<>
			<path d="M3 11.5 12 4l9 7.5" />
			<path d="M5.5 10v9.5h13V10" />
		</>
	),
	list: (
		<>
			<rect x="5" y="3.5" width="14" height="17" rx="2.5" />
			<path d="M9 8.5h6M9 12.5h6M9 16.5h3.5" />
		</>
	),
	users: (
		<>
			<circle cx="9" cy="8.5" r="3.2" />
			<path d="M3 19.5c.4-3.3 2.9-5.2 6-5.2s5.6 1.9 6 5.2" />
			<path d="M16 5.6a3.1 3.1 0 0 1 0 5.8M18.2 14.6c1.7.7 2.6 2.2 2.8 4.4" />
		</>
	),
	link: (
		<>
			<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
			<path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="6.5" />
			<path d="m20 20-4.2-4.2" />
		</>
	),
	chevron: <path d="m9 5 7 7-7 7" />,
	chevronDown: <path d="m6 9 6 6 6-6" />,
	back: <path d="m15 5-7 7 7 7" />,
	send: (
		<>
			<path d="M21 3 10.5 13.5" />
			<path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z" />
		</>
	),
	phone: (
		<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
	),
	clock: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.5V12l3 2" />
		</>
	),
	doc: (
		<>
			<path d="M7 3.5h7l4 4v13H7z" />
			<path d="M14 3.5v4h4M10 12.5h5M10 16h5" />
		</>
	),
	board: (
		<>
			<rect x="3.5" y="4.5" width="17" height="12" rx="2" />
			<path d="M8 20.5l2-4M16 20.5l-2-4" />
		</>
	),
	chat: <path d="M4 5.5h16v10H10l-4.5 4v-4H4z" />,
	plus: <path d="M12 5v14M5 12h14" />,
	logout: (
		<>
			<path d="M14 4.5h4.5v15H14" />
			<path d="M4.5 12H15M11.5 8.5 15 12l-3.5 3.5" />
		</>
	),
	mic: (
		<>
			<rect x="9" y="3.5" width="6" height="11" rx="3" />
			<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
		</>
	),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{PATHS[name]}
		</svg>
	)
}

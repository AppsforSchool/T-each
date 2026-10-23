import type { Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { Board } from './Board'
import { Chat } from './Chat'

function useMedia(query: string): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
	useEffect(() => {
		const mq = window.matchMedia(query)
		const on = () => setMatches(mq.matches)
		mq.addEventListener('change', on)
		return () => mq.removeEventListener('change', on)
	}, [query])
	return matches
}

/**
 * ボードとチャットの配置。
 * 広い画面（タブレット・PC）：左にボード、右にチャット。 狭い画面（スマートフォン）：下のタブで切り替える。
 */
export function Workspace({ sessionId, s }: { sessionId: string; s: SessionDoc<Timestamp> }) {
	const { userId } = useAuth()
	const wide = useMedia('(min-width: 900px)')
	const [tab, setTab] = useState<'board' | 'chat'>('board')

	const myRead = userId ? s.lastRead?.[userId] : undefined
	const unread =
		!!s.lastMessageBy &&
		s.lastMessageBy !== userId &&
		!!s.lastMessageAt &&
		(!myRead || s.lastMessageAt.toMillis() > myRead.toMillis())

	const chat = (active: boolean) => (
		<Chat sessionId={sessionId} myLastRead={myRead} canSend={s.status === 'active'} active={active} />
	)

	if (wide) {
		return (
			<div className="workspace wide">
				<div className="ws-board">
					<Board sessionId={sessionId} />
				</div>
				<div className="ws-chat">{chat(true)}</div>
			</div>
		)
	}

	// 狭い画面：どちらも表示したままにして（ボードの再接続を避ける）、見えるほうだけを切り替える
	return (
		<div className="workspace">
			<div className="ws-tabs">
				<button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>
					ボード
				</button>
				<button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
					チャット{unread && <span className="dot" />}
				</button>
			</div>
			<div className="ws-pane" style={{ display: tab === 'board' ? 'block' : 'none' }}>
				<Board sessionId={sessionId} />
			</div>
			<div className="ws-pane" style={{ display: tab === 'chat' ? 'block' : 'none' }}>
				{chat(tab === 'chat')}
			</div>
		</div>
	)
}

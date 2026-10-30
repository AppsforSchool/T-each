import type { Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { SessionDoc } from '../../shared/types'
import { useAuth } from '../auth'
import { Board } from './Board'
import { useUser } from '../lib/users'
import { Chat } from './Chat'
import { Icon } from './Icons'

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

	// カーソルの色の決め方に使う（依頼した側と、依頼された側で、色を分ける）
	const role = s.requesterId === userId ? 'requester' : 'tutor'

	const myRead = userId ? s.lastRead?.[userId] : undefined
	const unread =
		!!s.lastMessageBy &&
		s.lastMessageBy !== userId &&
		!!s.lastMessageAt &&
		(!myRead || s.lastMessageAt.toMillis() > myRead.toMillis())

	const requester = useUser(s.requesterId)
	const tutor = useUser(s.tutorId)

	const chat = (active: boolean) => (
		<Chat sessionId={sessionId} myLastRead={myRead} canSend={s.status === 'active'} active={active} />
	)

	// ボードの上の見出し：参加者と、カーソルの色（ボード側の色と合わせる）
	const boardHead = (
		<div className="pane-head">
			<span className="pane-title">
				<Icon name="board" size={18} />
				ボード
			</span>
			<span className="legend">
				<span className="legend-item">
					<i className="dot-req" />
					{requester?.name ?? '…'}（依頼者）
				</span>
				<span className="legend-item">
					<i className="dot-tutor" />
					{tutor?.name ?? '…'}（先生）
				</span>
			</span>
		</div>
	)
	const chatHead = (
		<div className="pane-head">
			<span className="pane-title">
				<Icon name="chat" size={18} />
				チャット
			</span>
		</div>
	)

	if (wide) {
		return (
			<div className="workspace wide">
				<div className="ws-board pane-card">
					{boardHead}
					<div className="pane-body">
						<Board sessionId={sessionId} role={role} />
					</div>
				</div>
				<div className="ws-chat pane-card">
					{chatHead}
					<div className="pane-body">{chat(true)}</div>
				</div>
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
			<div className="ws-pane pane-card" style={{ display: tab === 'board' ? 'flex' : 'none' }}>
				<div className="pane-body">
					<Board sessionId={sessionId} role={role} />
				</div>
			</div>
			<div className="ws-pane pane-card" style={{ display: tab === 'chat' ? 'flex' : 'none' }}>
				<div className="pane-body">{chat(tab === 'chat')}</div>
			</div>
		</div>
	)
}

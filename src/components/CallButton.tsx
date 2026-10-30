import { useCall } from '../lib/CallContext'
import { Icon } from './Icons'

/** セッション画面の、発信ボタン。通話できるのは、進行中（active）のセッションだけ。 */
export function CallButton({ sessionId }: { sessionId: string }) {
	const c = useCall()
	if (c.phase === 'idle')
		return (
			<button className="btn small call-btn" disabled={c.working} onClick={() => void c.start(sessionId)}>
				<Icon name="phone" size={16} />
				{c.working ? '準備中…' : '通話する'}
			</button>
		)
	if (c.sessionId === sessionId) return <span className="muted">通話中（画面の下のバーで操作できます）</span>
	return <span className="muted">別のセッションで、通話中です</span>
}

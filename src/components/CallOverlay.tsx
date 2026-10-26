import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCall } from '../lib/CallContext'
import { useUser } from '../lib/users'

function Elapsed({ since }: { since: Date | null }) {
	const [, setN] = useState(0)
	useEffect(() => {
		const t = setInterval(() => setN((n) => n + 1), 1000)
		return () => clearInterval(t)
	}, [])
	if (!since) return null
	const sec = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000))
	return (
		<span>
			{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}
		</span>
	)
}

/** アプリのどの画面でも、着信（全画面）と、呼び出し中・通話中のバー、通話に関するお知らせを出す。 */
export function CallOverlay() {
	const c = useCall()
	const navigate = useNavigate()
	const here = useLocation().pathname
	const partner = useUser(c.partnerId)
	const name = partner?.name ?? '…'
	const onSessionPage = c.sessionId !== null && here === `/s/${c.sessionId}`

	return (
		<>
			{c.notice && (
				<div className="call-toast" role="status">
					<span>{c.notice}</span>
					<button className="btn small ghost" onClick={c.clearNotice}>
						閉じる
					</button>
				</div>
			)}

			{c.phase === 'incoming' && (
				<div className="call-incoming" role="alertdialog" aria-label="着信">
					{partner?.imageUrl ? <img className="call-avatar" src={partner.imageUrl} alt="" /> : <div className="call-avatar" />}
					<p className="call-incoming-name">{name}さん</p>
					<p className="muted">から、通話の着信です</p>
					<div className="call-incoming-actions">
						<button className="btn call-reject" disabled={c.working} onClick={() => void c.reject()}>
							拒否
						</button>
						<button
							className="btn call-accept"
							disabled={c.working}
							onClick={async () => {
								const id = c.sessionId
								await c.answer()
								if (id) navigate(`/s/${id}`)
							}}
						>
							応答
						</button>
					</div>
					<p className="muted call-hint">「応答」を押すと、マイクの使用の許可を求められることがあります</p>
				</div>
			)}

			{(c.phase === 'calling' ||
				c.phase === 'connecting' ||
				c.phase === 'connected' ||
				c.phase === 'reconnecting' ||
				c.phase === 'orphan') && (
				<>
					<div className="call-bar-spacer" />
					<div className={`call-bar ${c.phase}`}>
						<div className="call-bar-text">
							{c.phase === 'calling' && <b>{name}さんを呼び出し中…</b>}
							{c.phase === 'connecting' && <b>{name}さんと接続中…</b>}
							{c.phase === 'connected' && (
								<b>
									通話中：{name}さん <Elapsed since={c.callStartedAt} />
									{!c.hasMic && '（聞くだけ）'}
								</b>
							)}
							{c.phase === 'reconnecting' && <b>再接続中…（{name}さん）</b>}
							{c.phase === 'orphan' && <b>{name}さんとの通話が、つながっていません</b>}
							{c.phase === 'connected' && c.route && <span className="call-route">{c.route}</span>}
						</div>
						<div className="call-bar-actions">
							{c.needUnlock && (
								<button className="btn small" onClick={c.unlock}>
									音を出す
								</button>
							)}
							{(c.phase === 'connected' || c.phase === 'reconnecting') && c.hasMic && (
								<button className="btn small ghost" onClick={c.toggleMute}>
									{c.muted ? 'ミュート解除' : 'ミュート'}
								</button>
							)}
							{!onSessionPage && c.sessionId && (
								<Link className="btn small ghost" to={`/s/${c.sessionId}`}>
									開く
								</Link>
							)}
							<button className="btn small call-end" onClick={() => void c.hangUp()}>
								{c.phase === 'calling' ? '取り消す' : '終了'}
							</button>
						</div>
					</div>
				</>
			)}
		</>
	)
}

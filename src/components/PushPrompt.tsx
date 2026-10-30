import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { enablePush, initPush, pushStatus, type PushStatus } from '../lib/push'

/** ホームに出す、通知のお知らせ。通知がオンなら、出ない。通知はオフでも、全機能が使える。 */
export function PushPrompt() {
	const { userId } = useAuth()
	const [status, setStatus] = useState<PushStatus>(pushStatus)
	const [configured, setConfigured] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!userId) return
		initPush(userId).catch((e: Error) => {
			if (e.message === 'unconfigured') setConfigured(false)
			else console.warn('push init', e)
		})
	}, [userId])

	if (!userId || !configured || status === 'granted' || status === 'unsupported') return null

	const turnOn = async () => {
		setBusy(true)
		setError(null)
		try {
			await enablePush(userId)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setStatus(pushStatus())
			setBusy(false)
		}
	}

	return (
		<section className="card" style={{ display: 'grid', gap: 8 }}>
			{status === 'needs-install' && (
				<p>
					iPhone・iPadで通知を受け取るには、画面の共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。
				</p>
			)}
			{status === 'denied' && (
				<p>通知がブロックされています。端末（ブラウザ）の設定で、このサイトの通知を許可してください。</p>
			)}
			{status === 'default' && (
				<>
					<p>通知をオンにすると、依頼・メッセージ・着信に、すぐに気づけます。</p>
					<p>
						<button className="btn" onClick={turnOn} disabled={busy}>
							{busy ? '準備中…' : '通知をオンにする'}
						</button>
					</p>
				</>
			)}
			{error && <p className="error">{error}</p>}
		</section>
	)
}

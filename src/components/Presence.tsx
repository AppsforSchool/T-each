import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'

const INTERVAL_MS = 45_000

/**
 * 「いま、画面を開いていて、どのセッションを見ているか」を、自分の文書に書く（画面が表示されている間だけ、45秒おき）。
 * 用途：相手がそのセッションを開いている間は、チャットのプッシュ通知を送らない（Workerが判定）。
 */
export function PresenceReporter() {
	const { userId } = useAuth()
	const { pathname } = useLocation()
	const openId = /^\/s\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null

	useEffect(() => {
		if (!userId) return
		const write = (open: string | null) =>
			setDoc(doc(db, 'teach_presence', userId), { lastSeenAt: serverTimestamp(), openSessionId: open }).catch(() => {})
		let timer: ReturnType<typeof setInterval> | undefined
		const start = () => {
			void write(openId)
			clearInterval(timer)
			timer = setInterval(() => void write(openId), INTERVAL_MS)
		}
		const onVisibility = () => {
			if (document.visibilityState === 'visible') start()
			else {
				clearInterval(timer)
				void write(null) // 画面が見えなくなったら、「開いていない」にする
			}
		}
		if (document.visibilityState === 'visible') start()
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [userId, openId])

	return null
}

import { LIMITS } from '../shared/limits'
import type { FsEnv } from './firestore'
import { fsGet } from './firestore'

// プッシュ通知（OneSignal）。送信は、必ず、Workerから行う（キーを画面に渡さないため）。
// キー（ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY）が未登録なら、何もしない（通知なしでも、全機能が使える）。

export type PushEnv = FsEnv & { ONESIGNAL_APP_ID?: string; ONESIGNAL_REST_API_KEY?: string }

/** 通知から開く画面のアドレス（公開サイト） */
const APP_URL = 'https://appsforschool.github.io/T-each/'
/** プレゼンスが、この時間より古ければ、「開いていない」とみなす */
const PRESENCE_FRESH_MS = 90_000

export type PushRequest = {
	to: string[]
	/** 送った人（本文に、名前を入れるため） */
	fromId: string
	title: string
	body: (fromName: string) => string
	sessionId: string
	/** true：宛先が、そのセッションを開いている間は、送らない（チャットの新着） */
	skipIfOpen?: boolean
}

/** 応答を遅らせずに、通知を送る。失敗しても、処理には影響させない。 */
export function notify(env: PushEnv, ctx: ExecutionContext, req: PushRequest): void {
	if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_REST_API_KEY) return
	ctx.waitUntil(send(env, req).catch((e) => console.error('push failed', e)))
}

async function send(env: PushEnv, req: PushRequest): Promise<void> {
	let to = req.to
	if (req.skipIfOpen) {
		const open = await Promise.all(to.map((id) => isOpen(env, id, req.sessionId)))
		to = to.filter((_, i) => !open[i])
	}
	if (to.length === 0) return

	const from = await fsGet(env, `users_random/${req.fromId}`)
	const fromName = typeof from?.data.name === 'string' && from.data.name ? from.data.name : req.fromId
	const body = req.body(fromName)

	const res = await fetch('https://api.onesignal.com/notifications?c=push', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
		},
		body: JSON.stringify({
			app_id: env.ONESIGNAL_APP_ID,
			target_channel: 'push',
			include_aliases: { external_id: to },
			headings: { en: req.title, ja: req.title },
			contents: { en: body, ja: body },
			url: `${APP_URL}#/s/${req.sessionId}`,
		}),
	})
	if (!res.ok) console.error('onesignal error', res.status, await res.text())
}

/** 宛先が、いま、そのセッションを開いているか（プレゼンスで判定） */
async function isOpen(env: FsEnv, userId: string, sessionId: string): Promise<boolean> {
	const doc = await fsGet(env, `teach_presence/${userId}`)
	const seen = doc?.data.lastSeenAt
	return doc?.data.openSessionId === sessionId && seen instanceof Date && Date.now() - seen.getTime() < PRESENCE_FRESH_MS
}

/** 本文に入れるときの、メッセージの切り詰め */
export const clip = (text: string, max = LIMITS.pushPreviewChars) => (text.length > max ? text.slice(0, max) + '…' : text)

/** POST /api/push-config — 画面が、OneSignalを初期化するための、App ID を返す（公開してよい値） */
export async function pushConfig(_req: unknown, env: PushEnv): Promise<Response> {
	return Response.json({ appId: env.ONESIGNAL_APP_ID || null })
}

import type { IRequest } from 'itty-router'
import { LIMITS } from '../shared/limits'
import type { FsEnv } from './firestore'
import { fsBatch, fsGet } from './firestore'
import { fail } from './http'

// 送信頻度の簡易な制限。Workerのインスタンスごとの記憶なので、完全ではない（仮）。厳密にするなら、Durable Objectで数える。
const recent = new Map<string, number[]>()

/** POST /api/sessions/:id/messages — チャットのメッセージを送る（active のセッションの参加者だけ）。 */
export async function sendMessage(request: IRequest, env: FsEnv, who: { userId: string }): Promise<Response> {
	const sessionId = String(request.params.id ?? '')
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) return fail(404, 'not_found', 'セッションが見つかりません')

	const body = (await request.json().catch(() => ({}))) as { text?: unknown }
	const text = typeof body.text === 'string' ? body.text.trim() : ''
	if (!text) return fail(400, 'empty', 'メッセージを入力してください')
	if (text.length > LIMITS.chatMessageMaxChars)
		return fail(400, 'too_long', `メッセージは${LIMITS.chatMessageMaxChars}文字までです`)

	// 送信頻度
	const nowMs = Date.now()
	const windowMs = LIMITS.chatRateLimit.windowSeconds * 1000
	const times = (recent.get(who.userId) ?? []).filter((t) => nowMs - t < windowMs)
	if (times.length >= LIMITS.chatRateLimit.max)
		return fail(429, 'rate_limited', '送信が多すぎます。少し待ってから、もう一度お試しください')
	times.push(nowMs)
	recent.set(who.userId, times)

	const doc = await fsGet(env, `teach_sessions/${sessionId}`)
	const s = doc?.data
	const memberIds = Array.isArray(s?.memberIds) ? (s!.memberIds as string[]) : []
	if (!doc || !s || !memberIds.includes(who.userId)) return fail(404, 'not_found', 'セッションが見つかりません')
	if (s.status !== 'active')
		return fail(409, 'not_active', 'このセッションには、いまは書き込めません（終了している場合は、再開してください）')

	const now = new Date(nowMs)
	await fsBatch(env, [
		{
			type: 'set',
			path: `teach_sessions/${sessionId}`,
			data: { lastMessageAt: now, lastMessageBy: who.userId, lastActivityAt: now, updatedAt: now },
		},
		{
			type: 'create',
			path: `teach_sessions/${sessionId}/messages/${crypto.randomUUID()}`,
			data: { type: 'message', senderId: who.userId, text, kind: null, createdAt: now },
		},
	])
	return Response.json({ ok: true })
}

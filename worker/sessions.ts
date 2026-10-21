import { LIMITS } from '../shared/limits'
import type { SessionDoc, SessionSecrets } from '../shared/types'
import type { FsData, FsEnv } from './firestore'
import { fsBatch, fsGet, fsQuery } from './firestore'
import { fail } from './http'

type CreateBody = {
	tutorId?: unknown
	problemId?: unknown
	text?: unknown
	comment?: unknown
	uploadIds?: unknown
	importedImageUrls?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function isAllowedImportedUrl(u: string): boolean {
	try {
		const url = new URL(u)
		return url.protocol === 'https:' && (LIMITS.importedImageHosts as readonly string[]).includes(url.hostname)
	} catch {
		return false
	}
}

/** POST /api/sessions — 依頼を作る（status: requested）。 */
export async function createSession(request: Request, env: FsEnv, who: { userId: string }): Promise<Response> {
	let body: CreateBody
	try {
		body = (await request.json()) as CreateBody
	} catch {
		return fail(400, 'invalid_json', 'リクエストの形式が正しくありません')
	}

	const tutorId = str(body.tutorId).trim()
	const text = str(body.text).trim()
	const comment = str(body.comment).trim()
	const problemId = str(body.problemId).trim() || null
	const uploadIds = strList(body.uploadIds)
	const imported = strList(body.importedImageUrls)

	// ---- 入力の検証 ----
	if (!tutorId || tutorId === who.userId) return fail(400, 'invalid_tutor', '依頼する相手を選び直してください')
	if (text.length > LIMITS.sourceTextMaxChars)
		return fail(400, 'text_too_long', `問題文は${LIMITS.sourceTextMaxChars}文字までです`)
	if (comment.length > LIMITS.commentMaxChars)
		return fail(400, 'comment_too_long', `コメントは${LIMITS.commentMaxChars}文字までです`)
	if (uploadIds.length > LIMITS.maxImagesPerRequest)
		return fail(400, 'too_many_images', `画像は${LIMITS.maxImagesPerRequest}枚までです`)
	if (new Set(uploadIds).size !== uploadIds.length) return fail(400, 'duplicate_upload', '同じ画像が重複しています')
	if (imported.length > LIMITS.maxImportedImages) return fail(400, 'too_many_imported', '引き継ぐ画像が多すぎます')
	if (!imported.every(isAllowedImportedUrl)) return fail(400, 'invalid_image_url', '使えない画像のURLが含まれています')
	if (!text && uploadIds.length === 0 && imported.length === 0)
		return fail(400, 'empty', '問題文か画像のどちらかが必要です')

	// ---- 相手が実在するか ----
	if (!(await fsGet(env, `users_random/${tutorId}`))) return fail(404, 'tutor_not_found', '相手が見つかりません')

	// ---- 上限（返答待ちの数） ----
	const pending = await fsQuery(
		env,
		'teach_sessions',
		[['requesterId', who.userId], ['status', 'requested']],
		LIMITS.maxPendingRequestsPerUser
	)
	if (pending.length >= LIMITS.maxPendingRequestsPerUser)
		return fail(429, 'too_many_pending', `返答待ちの依頼が${LIMITS.maxPendingRequestsPerUser}件に達しています`)
	if (pending.some((s) => s.data.tutorId === tutorId))
		return fail(409, 'pending_exists', 'この相手には、すでに返答待ちの依頼があります')

	// ---- アップロード済みの画像が、自分のもので、まだ使われていないか ----
	const uploads = await Promise.all(uploadIds.map((id) => fsGet(env, `teach_uploads/${id}`)))
	for (const u of uploads) {
		if (!u || u.data.uploaderId !== who.userId || u.data.sessionId != null)
			return fail(400, 'invalid_upload', 'アップロードした画像を確認できませんでした。もう一度お試しください')
	}
	const ups = uploads as NonNullable<(typeof uploads)[number]>[]

	// ---- 作成（セッション・秘密の情報・アップロードの紐づけを、まとめて書く） ----
	const now = new Date()
	const sessionId = crypto.randomUUID()
	const addedUrls = ups.map((u) => String(u.data.url))

	const session: SessionDoc = {
		requesterId: who.userId,
		tutorId,
		memberIds: [who.userId, tutorId],
		status: 'requested',
		source: { problemId, text, comment, imageUrls: [...imported, ...addedUrls] },
		createdAt: now,
		updatedAt: now,
		lastActivityAt: now,
		lastMessageAt: null,
		lastRead: {},
		approvedAt: null,
		declinedAt: null,
		declineReason: null,
		autoDeclined: false,
		endedAt: null,
		endedBy: null,
		autoEnded: false,
		deleteAt: null,
		boardInitialized: false,
		imageCount: ups.length,
	}
	const secrets: SessionSecrets = {
		images: ups.map((u) => ({
			url: String(u.data.url),
			deleteUrl: String(u.data.deleteUrl),
			addedBy: who.userId,
			addedAt: now,
		})),
	}

	try {
		await fsBatch(env, [
			{ type: 'create', path: `teach_sessions/${sessionId}`, data: session as unknown as FsData },
			{ type: 'create', path: `teach_sessions/${sessionId}/secrets/images`, data: secrets as unknown as FsData },
			...ups.map((u, i) => ({
				type: 'set' as const,
				path: `teach_uploads/${uploadIds[i]}`,
				data: { sessionId },
				ifUpdateTime: u.updateTime, // 同時に、別の依頼で使われていないことを保証する
			})),
		])
	} catch (e) {
		console.error(e)
		return fail(409, 'conflict', '依頼を作成できませんでした。もう一度お試しください')
	}
	return Response.json({ sessionId }, { status: 201 })
}

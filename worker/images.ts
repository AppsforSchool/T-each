import type { IRequest } from 'itty-router'
import { LIMITS } from '../shared/limits'
import type { FsEnv, FsOp } from './firestore'
import { fsBatch, fsGet, fsQuery } from './firestore'
import { fail } from './http'

type ImgbbResponse = { success?: boolean; data?: { url?: string; delete_url?: string } }
type ImgEnv = FsEnv & { IMGBB_API_KEY?: string }

/** リクエストから画像ファイルを取り出し、形式とサイズを検証する。問題があれば、そのままエラー応答を返す。 */
async function readImageFile(request: Request): Promise<File | Response> {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return fail(400, 'invalid_form', 'リクエストの形式が正しくありません')
	}
	const file = form.get('file')
	if (!(file instanceof File)) return fail(400, 'no_file', 'ファイルがありません')
	if (!(LIMITS.imageMimeTypes as readonly string[]).includes(file.type))
		return fail(415, 'unsupported_type', 'この形式の画像は使えません（JPEG・PNG・WebP・GIFのみ）')
	if (file.size > LIMITS.workerImageMaxBytes) return fail(413, 'too_large', '画像のサイズが大きすぎます')
	return file
}

/** ImgBBにアップロードする。保存先を、ほかに切り替えるときは、ここだけを変える。 */
async function imgbbUpload(env: ImgEnv, file: File): Promise<{ url: string; deleteUrl: string } | Response> {
	if (!env.IMGBB_API_KEY) return fail(500, 'server_config', 'サーバーの設定が不足しています')
	const out = new FormData()
	out.append('image', file, file.name || 'image')
	const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, {
		method: 'POST',
		body: out,
	})
	const raw = await res.text()
	let json: ImgbbResponse | null = null
	try {
		json = JSON.parse(raw) as ImgbbResponse
	} catch {
		// JSONではない応答（エラーページなど）
	}
	const url = json?.data?.url
	const deleteUrl = json?.data?.delete_url
	if (!res.ok || !json?.success || !url || !deleteUrl) {
		// 原因を調べられるように、ImgBBの応答の先頭だけをログに残す（キーは含まれない）
		console.error('imgbb upload failed', res.status, raw.slice(0, 300))
		return fail(502, 'upload_failed', `画像のアップロードに失敗しました（ImgBB: ${res.status}）`)
	}
	return { url, deleteUrl }
}

/** POST /api/images — 依頼の作成前に、画像をアップロードする。まだ、どのセッションにも付いていない状態で保存する。 */
export async function uploadImage(request: Request, env: ImgEnv, who: { userId: string }): Promise<Response> {
	const file = await readImageFile(request)
	if (file instanceof Response) return file

	// まだ依頼に付けていないアップロードが、多すぎないか（古い分は数えない）
	const since = Date.now() - LIMITS.unattachedUploadHours * 3600_000
	const pending = await fsQuery(env, 'teach_uploads', [['uploaderId', who.userId], ['sessionId', null]], 50)
	const recent = pending.filter((d) => d.data.createdAt instanceof Date && d.data.createdAt.getTime() > since)
	if (recent.length >= LIMITS.maxUnattachedUploads)
		return fail(429, 'too_many_uploads', '未使用のアップロードが多すぎます。しばらくしてから、もう一度お試しください')

	const up = await imgbbUpload(env, file)
	if (up instanceof Response) return up

	const uploadId = crypto.randomUUID()
	await fsBatch(env, [
		{
			type: 'create',
			path: `teach_uploads/${uploadId}`,
			// delete_url は、持っていれば誰でも画像を消せるため、画面には返さない
			data: { uploaderId: who.userId, url: up.url, deleteUrl: up.deleteUrl, bytes: file.size, createdAt: new Date(), sessionId: null },
		},
	])
	return Response.json({ uploadId, url: up.url })
}

/**
 * POST /api/sessions/:id/images — ボードに追加する画像をアップロードする（active のセッションの参加者だけ）。
 * 1セッションあたりの枚数の上限を検証し、削除用URLは、参加者が読めない場所（secrets/images）に記録する。
 */
export async function uploadSessionImage(request: IRequest, env: ImgEnv, who: { userId: string }): Promise<Response> {
	const sessionId = String(request.params.id ?? '')
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) return fail(404, 'not_found', 'セッションが見つかりません')

	const file = await readImageFile(request)
	if (file instanceof Response) return file

	const session = await fsGet(env, `teach_sessions/${sessionId}`)
	const s = session?.data
	const memberIds = Array.isArray(s?.memberIds) ? (s!.memberIds as string[]) : []
	if (!session || !s || !memberIds.includes(who.userId)) return fail(404, 'not_found', 'セッションが見つかりません')
	if (s.status !== 'active')
		return fail(409, 'not_active', 'このセッションには、いまは画像を追加できません（終了している場合は、再開してください）')

	const secretsPath = `teach_sessions/${sessionId}/secrets/images`
	let uploaded: { url: string; deleteUrl: string } | null = null

	// 同時に、別の画像が追加されたときに備えて、数回までやり直す
	for (let attempt = 0; attempt < 3; attempt++) {
		const secrets = await fsGet(env, secretsPath)
		const images = Array.isArray(secrets?.data.images) ? (secrets!.data.images as unknown[]) : []
		if (images.length >= LIMITS.maxImagesPerSession)
			return fail(409, 'image_limit', `このセッションに追加できる画像は、${LIMITS.maxImagesPerSession}枚までです`)

		if (!uploaded) {
			const up = await imgbbUpload(env, file)
			if (up instanceof Response) return up
			uploaded = up
		}

		const now = new Date()
		const next = [...images, { url: uploaded.url, deleteUrl: uploaded.deleteUrl, addedBy: who.userId, addedAt: now }]
		const ops: FsOp[] = [
			secrets
				? { type: 'set', path: secretsPath, data: { images: next }, ifUpdateTime: secrets.updateTime }
				: { type: 'create', path: secretsPath, data: { images: next } },
			{ type: 'set', path: `teach_sessions/${sessionId}`, data: { imageCount: next.length, updatedAt: now } },
		]
		try {
			await fsBatch(env, ops)
			return Response.json({ url: uploaded.url })
		} catch (e) {
			console.error('uploadSessionImage batch failed', attempt, e)
		}
	}
	return fail(409, 'conflict', '画像を追加できませんでした。もう一度お試しください')
}

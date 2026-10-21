import { LIMITS } from '../shared/limits'
import type { FsEnv } from './firestore'
import { fsBatch, fsQuery } from './firestore'
import { fail } from './http'

type ImgbbResponse = { success?: boolean; data?: { url?: string; delete_url?: string } }

/** POST /api/images — 画像を、ImgBBにアップロードする。まだ、どのセッションにも付いていない状態で保存する。 */
export async function uploadImage(
	request: Request,
	env: FsEnv & { IMGBB_API_KEY?: string },
	who: { userId: string }
): Promise<Response> {
	if (!env.IMGBB_API_KEY) return fail(500, 'server_config', 'サーバーの設定が不足しています')

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

	// まだ依頼に付けていないアップロードが、多すぎないか（古い分は数えない）
	const since = Date.now() - LIMITS.unattachedUploadHours * 3600_000
	const pending = await fsQuery(env, 'teach_uploads', [['uploaderId', who.userId], ['sessionId', null]], 50)
	const recent = pending.filter((d) => d.data.createdAt instanceof Date && d.data.createdAt.getTime() > since)
	if (recent.length >= LIMITS.maxUnattachedUploads)
		return fail(429, 'too_many_uploads', '未使用のアップロードが多すぎます。しばらくしてから、もう一度お試しください')

	const out = new FormData()
	out.append('image', file, file.name || 'image')
	const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, {
		method: 'POST',
		body: out,
	})
	const json = (await res.json().catch(() => null)) as ImgbbResponse | null
	const url = json?.data?.url
	const deleteUrl = json?.data?.delete_url
	if (!res.ok || !json?.success || !url || !deleteUrl)
		return fail(502, 'upload_failed', '画像のアップロードに失敗しました')

	const uploadId = crypto.randomUUID()
	await fsBatch(env, [
		{
			type: 'create',
			path: `teach_uploads/${uploadId}`,
			// delete_url は、持っていれば誰でも画像を消せるため、画面には返さない
			data: { uploaderId: who.userId, url, deleteUrl, bytes: file.size, createdAt: new Date(), sessionId: null },
		},
	])
	return Response.json({ uploadId, url })
}

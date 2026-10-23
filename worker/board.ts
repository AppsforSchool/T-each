import type { IRequest } from 'itty-router'
import type { FsEnv } from './firestore'
import { fsBatch, fsGet } from './firestore'
import { fail } from './http'
import { signBoardToken, verifyBoardToken } from './boardToken'

export type BoardEnv = FsEnv & {
	TLDRAW_DURABLE_OBJECT: DurableObjectNamespace
	BOARD_TOKEN_SECRET: string
	ALLOWED_ORIGINS: string
}

const TOKEN_SECONDS = 300 // トークンの有効期間（仮）。接続のたびに取り直すので、短くてよい

// Durable Object へのRPC呼び出し用（型の生成を省くため、any として扱う）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boardStub = (env: BoardEnv, sessionId: string): any =>
	env.TLDRAW_DURABLE_OBJECT.get(env.TLDRAW_DURABLE_OBJECT.idFromName(sessionId))

type SessionData = Record<string, unknown>

/**
 * ボードを用意する（初期配置を、一度だけ行う）。何度呼んでも、同じ結果になる。
 * 承認の処理から呼ぶほか、古いセッションの補修として、トークン発行のときにも呼ぶ。
 */
export async function ensureBoard(env: BoardEnv, sessionId: string, s: SessionData): Promise<void> {
	const source = (s.source ?? {}) as { text?: string; comment?: string; imageUrls?: string[] }
	await boardStub(env, sessionId).initBoard({
		text: source.text ?? '',
		comment: source.comment ?? '',
		imageUrls: Array.isArray(source.imageUrls) ? source.imageUrls : [],
	})
}

/** 権限が変わったとき（終了・再開）に、全接続を切って、再接続（＝新しいトークン）を促す。失敗しても処理は止めない。 */
export async function kickBoard(env: BoardEnv, sessionId: string): Promise<void> {
	try {
		await boardStub(env, sessionId).kickAll()
	} catch (e) {
		console.error('kickBoard failed', e)
	}
}

/** POST /api/sessions/:id/board-token — ボードへの接続用トークンを発行する。 */
export async function issueBoardToken(request: IRequest, env: BoardEnv, who: { userId: string }): Promise<Response> {
	const sessionId = String(request.params.id ?? '')
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) return fail(404, 'not_found', 'セッションが見つかりません')

	const doc = await fsGet(env, `teach_sessions/${sessionId}`)
	const s = doc?.data
	const memberIds = Array.isArray(s?.memberIds) ? (s!.memberIds as string[]) : []
	if (!doc || !s || !memberIds.includes(who.userId)) return fail(404, 'not_found', 'セッションが見つかりません')

	// active なら書き込み可、承認されたことがある ended なら読み取り専用。それ以外は使えない。
	let readonly: boolean
	if (s.status === 'active') readonly = false
	else if (s.status === 'ended' && s.approvedAt != null) readonly = true
	else return fail(409, 'board_unavailable', 'このセッションのボードは、いまは使えません')

	if (!s.boardInitialized) {
		try {
			await ensureBoard(env, sessionId, s)
			await fsBatch(env, [{ type: 'set', path: `teach_sessions/${sessionId}`, data: { boardInitialized: true } }])
		} catch (e) {
			console.error('ensureBoard failed', e)
			return fail(502, 'board_failed', 'ボードを準備できませんでした。もう一度お試しください')
		}
	}

	const exp = Math.floor(Date.now() / 1000) + TOKEN_SECONDS
	const token = await signBoardToken({ roomId: sessionId, userId: who.userId, readonly, exp }, env.BOARD_TOKEN_SECRET)
	return Response.json({ token, readonly, expiresIn: TOKEN_SECONDS })
}

/** GET /api/board/:id/connect?token=… — ボードのWebSocket接続。トークンを検証して、Durable Objectへ中継する。 */
export async function boardConnect(request: IRequest, env: BoardEnv): Promise<Response> {
	if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'upgrade_required', 'WebSocketで接続してください')

	// 許可した画面のオリジンからの接続だけを受け付ける
	const origin = request.headers.get('Origin')
	const allowed = env.ALLOWED_ORIGINS.split(',').map((x) => x.trim())
	if (!origin || !allowed.includes(origin)) return fail(403, 'bad_origin', '許可されていない接続元です')

	const claims = await verifyBoardToken(String(request.query.token ?? ''), env.BOARD_TOKEN_SECRET)
	if (!claims || claims.roomId !== request.params.id) return fail(401, 'invalid_token', '接続の許可を確認できませんでした')

	const headers = new Headers(request.headers)
	headers.set('x-board-readonly', claims.readonly ? '1' : '0')
	headers.set('x-board-user', claims.userId)
	return boardStub(env, claims.roomId).fetch(request.url, { headers })
}

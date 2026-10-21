import { AutoRouter, error, type IRequest } from 'itty-router'
import { verifyFirebaseIdToken } from './firebaseAuth'
import { fsDelete, fsGet, fsSet } from './firestore'
import { uploadImage } from './images'
import { createSession } from './sessions'
import { sessionAction } from './transitions'

export interface Env {
	FIREBASE_PROJECT_ID: string
	/** サービスアカウントの鍵（JSON）。Secretとして登録する */
	FIREBASE_SERVICE_ACCOUNT: string
	/** ImgBBのAPIキー。Secretとして登録する */
	IMGBB_API_KEY: string
	ALLOWED_ORIGINS: string
}

const LOGIN_DOMAIN = 'appsforschool.com'

export type Authenticated = { uid: string; userId: string }

/** Authorization: Bearer <FirebaseのIDトークン> を検証し、ユーザーIDを返す。失敗したら null。 */
export async function authenticate(request: Request, env: Env): Promise<Authenticated | null> {
	const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')
	if (!m) return null
	const payload = await verifyFirebaseIdToken(m[1], env.FIREBASE_PROJECT_ID)
	if (!payload?.email) return null
	const [local, domain] = payload.email.split('@')
	if (domain !== LOGIN_DOMAIN || !local) return null
	// userId は users_random のドキュメントIDと同じ。クライアントが送ってきたIDは信用せず、検証済みのトークンから決める。
	return { uid: payload.sub, userId: local }
}

type AuthedHandler = (request: IRequest, env: Env, who: Authenticated) => Promise<Response>

/** ログインを検証してから、処理を呼ぶ。検証に失敗したら 401 を返す。 */
const authed =
	(handler: AuthedHandler) =>
	async (request: IRequest, env: Env): Promise<Response> => {
		const who = await authenticate(request, env)
		if (!who) return error(401, { error: 'unauthorized', message: 'ログインが必要です' })
		return handler(request, env, who)
	}

const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(500, 'Internal error')
	},
})
	.get('/api/whoami', async (request, env) => {
		const who = await authenticate(request, env)
		if (!who) return error(401, 'Invalid or missing token')
		return Response.json(who)
	})
	.post('/api/images', authed(uploadImage))
	.post('/api/sessions', authed(createSession))
	.post('/api/sessions/:id/:action', authed(sessionAction))
	// 【M2.1の確認用・あとで削除】Workerから、Firestoreに書き込み・読み取りできるかの確認。自分のドキュメントだけに書く。
	.get('/api/dev/firestore-check', async (request, env) => {
		const who = await authenticate(request, env)
		if (!who) return error(401, 'Invalid or missing token')
		const path = `teach_dev/${who.userId}`
		await fsSet(env, path, { checkedAt: new Date(), note: 'M2.1 の確認', n: 1, nested: { ok: true } })
		const read = await fsGet(env, path)
		await fsDelete(env, path)
		return Response.json({ wrote: path, read, deletedAfterCheck: true })
	})
	.all('*', () => error(404, 'Not found'))

// ---- CORS（画面とWorkerが別のオリジンのため必要） ----
function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get('Origin')
	const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
	if (!origin || !allowed.includes(origin)) return {}
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) })
		}
		const res = await router.fetch(request, env, ctx)
		if (res.status === 101) return res // WebSocketの接続は、そのまま返す（後のボードの段階で使う）
		const headers = new Headers(res.headers)
		for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v)
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
	},
}

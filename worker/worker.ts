import { AutoRouter, error, type IRequest } from 'itty-router'
import { verifyFirebaseIdToken } from './firebaseAuth'
import { boardConnect, issueBoardToken } from './board'
import { callAction, iceServers } from './calls'
import { uploadImage, uploadSessionImage } from './images'
import { sendMessage } from './messages'
import { createSession } from './sessions'
import { sessionAction } from './transitions'

// ボードのDurable Object（クラスは、ここから公開する必要がある）
export { TldrawDurableObject } from './TldrawDurableObject'

export interface Env {
	FIREBASE_PROJECT_ID: string
	/** サービスアカウントの鍵（JSON）。Secretとして登録する */
	FIREBASE_SERVICE_ACCOUNT: string
	/** ImgBBのAPIキー。Secretとして登録する */
	IMGBB_API_KEY: string
	/** ボード接続用トークンの署名鍵。Secretとして登録する */
	BOARD_TOKEN_SECRET: string
	/** ボード1つ（＝セッション1つ）につき、Durable Objectを1つ使う。wrangler.toml の bindings で登録している */
	TLDRAW_DURABLE_OBJECT: DurableObjectNamespace
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

type AuthedHandler = (request: IRequest, env: Env, who: Authenticated, ctx: ExecutionContext) => Promise<Response>

/** ログインを検証してから、処理を呼ぶ。検証に失敗したら 401 を返す。 */
const authed =
	(handler: AuthedHandler) =>
	async (request: IRequest, env: Env, ctx: ExecutionContext): Promise<Response> => {
		const who = await authenticate(request, env)
		if (!who) return error(401, { error: 'unauthorized', message: 'ログインが必要です' })
		return handler(request, env, who, ctx)
	}

const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(500, 'Internal error')
	},
})
	.post('/api/images', authed(uploadImage))
	.post('/api/sessions', authed(createSession))
	.post('/api/sessions/:id/messages', authed(sendMessage))
	.post('/api/sessions/:id/images', authed(uploadSessionImage))
	.post('/api/sessions/:id/board-token', authed(issueBoardToken))
	.post('/api/ice-servers', authed(iceServers))
	.post('/api/sessions/:id/call/:action', authed(callAction))
	// ボードの接続は、Firebaseのログインではなく、上のトークンで認証する（WebSocketはヘッダーを付けられないため）
	.get('/api/board/:id/connect', boardConnect)
	.post('/api/sessions/:id/:action', authed(sessionAction))
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
		if (res.status === 101) return res // WebSocketの接続（ボード）は、そのまま返す
		const headers = new Headers(res.headers)
		for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v)
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
	},
}

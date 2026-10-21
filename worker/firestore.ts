// WorkerからFirestoreを読み書きする（REST API ＋ サービスアカウント）。
// サービスアカウントの鍵（JSON）は、WorkerのSecret「FIREBASE_SERVICE_ACCOUNT」に入れる。
// この経路はFirestoreのセキュリティルールを通らない（管理者権限）ため、Workerのコード側で、必ず権限を検証してから使うこと。

export type FsEnv = { FIREBASE_PROJECT_ID: string; FIREBASE_SERVICE_ACCOUNT: string }

type ServiceAccount = { client_email: string; private_key: string }

const enc = new TextEncoder()

function b64url(input: string | ArrayBuffer | Uint8Array): string {
	const bytes = typeof input === 'string' ? enc.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input)
	let s = ''
	for (const b of bytes) s += String.fromCharCode(b)
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
	const b64 = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s+/g, '')
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// ---- アクセストークン（サービスアカウントのJWTを、Googleのトークンと交換する） ----
let tokenCache: { token: string; expiresAt: number } | null = null

async function getAccessToken(env: FsEnv): Promise<string> {
	if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.token

	const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount
	const now = Math.floor(Date.now() / 1000)
	const unsigned =
		b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
		'.' +
		b64url(
			JSON.stringify({
				iss: sa.client_email,
				scope: 'https://www.googleapis.com/auth/datastore',
				aud: 'https://oauth2.googleapis.com/token',
				iat: now,
				exp: now + 3600,
			})
		)
	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToBytes(sa.private_key),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	)
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned))

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${b64url(sig)}`,
		}),
	})
	if (!res.ok) throw new Error(`token request failed: ${res.status}`)
	const json = (await res.json()) as { access_token: string; expires_in: number }
	tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
	return json.access_token
}

// ---- Firestoreの値の形式（型つきJSON）との相互変換 ----
type FsValue =
	| { nullValue: null }
	| { booleanValue: boolean }
	| { integerValue: string }
	| { doubleValue: number }
	| { stringValue: string }
	| { timestampValue: string }
	| { arrayValue: { values?: FsValue[] } }
	| { mapValue: { fields?: Record<string, FsValue> } }

export type FsData = Record<string, unknown>

export function encodeValue(v: unknown): FsValue {
	if (v === null || v === undefined) return { nullValue: null }
	if (typeof v === 'boolean') return { booleanValue: v }
	if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
	if (typeof v === 'string') return { stringValue: v }
	if (v instanceof Date) return { timestampValue: v.toISOString() }
	if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } }
	if (typeof v === 'object') {
		const fields: Record<string, FsValue> = {}
		for (const [k, val] of Object.entries(v as FsData)) if (val !== undefined) fields[k] = encodeValue(val)
		return { mapValue: { fields } }
	}
	throw new Error('unsupported value type: ' + typeof v)
}

export function decodeValue(v: FsValue): unknown {
	if ('nullValue' in v) return null
	if ('booleanValue' in v) return v.booleanValue
	if ('integerValue' in v) return Number(v.integerValue)
	if ('doubleValue' in v) return v.doubleValue
	if ('stringValue' in v) return v.stringValue
	if ('timestampValue' in v) return new Date(v.timestampValue)
	if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue)
	if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {})
	return undefined
}

function decodeFields(fields: Record<string, FsValue>): FsData {
	const out: FsData = {}
	for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v)
	return out
}

// ---- 読み書き ----
const base = (env: FsEnv) =>
	`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`

export type FsDoc = { id: string; data: FsData; updateTime: string }

async function call(env: FsEnv, method: string, url: string, body?: unknown): Promise<Response> {
	const token = await getAccessToken(env)
	return fetch(url, {
		method,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}

/** ドキュメントを1件読む。無ければ null。 */
export async function fsGet(env: FsEnv, path: string): Promise<FsDoc | null> {
	const res = await call(env, 'GET', `${base(env)}/${path}`)
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`fsGet ${path}: ${res.status} ${await res.text()}`)
	const j = (await res.json()) as { name: string; fields?: Record<string, FsValue>; updateTime: string }
	return { id: j.name.split('/').pop() as string, data: decodeFields(j.fields ?? {}), updateTime: j.updateTime }
}

/** 渡した項目だけを書く（無ければ作る。他の項目は残す）。 */
export async function fsSet(env: FsEnv, path: string, data: FsData): Promise<void> {
	const keys = Object.keys(data).filter((k) => data[k] !== undefined)
	const mask = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent('`' + k + '`')}`).join('&')
	const fields: Record<string, FsValue> = {}
	for (const k of keys) fields[k] = encodeValue(data[k])
	const res = await call(env, 'PATCH', `${base(env)}/${path}?${mask}`, { fields })
	if (!res.ok) throw new Error(`fsSet ${path}: ${res.status} ${await res.text()}`)
}

export async function fsDelete(env: FsEnv, path: string): Promise<void> {
	const res = await call(env, 'DELETE', `${base(env)}/${path}`)
	if (!res.ok && res.status !== 404) throw new Error(`fsDelete ${path}: ${res.status} ${await res.text()}`)
}

// ---- 検索（「等しい」条件だけ。複数指定は AND）。並べ替えはしない（インデックスを作らずに済ませるため） ----
export type FsFilter = [field: string, value: unknown]

export async function fsQuery(env: FsEnv, collectionId: string, filters: FsFilter[], limit = 100): Promise<FsDoc[]> {
	const fieldFilters = filters.map(([field, value]) => ({
		fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encodeValue(value) },
	}))
	const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: 'AND', filters: fieldFilters } }
	const res = await call(env, 'POST', `${base(env)}:runQuery`, {
		structuredQuery: { from: [{ collectionId }], where, limit },
	})
	if (!res.ok) throw new Error(`fsQuery ${collectionId}: ${res.status} ${await res.text()}`)
	const rows = (await res.json()) as {
		document?: { name: string; fields?: Record<string, FsValue>; updateTime: string }
	}[]
	return rows
		.filter((r) => r.document)
		.map((r) => ({
			id: r.document!.name.split('/').pop() as string,
			data: decodeFields(r.document!.fields ?? {}),
			updateTime: r.document!.updateTime,
		}))
}

// ---- 複数の書き込みを、まとめて（全部成功するか、全部失敗するか）実行する ----
export type FsOp =
	| { type: 'create'; path: string; data: FsData } // すでに存在すると失敗する
	| { type: 'set'; path: string; data: FsData; ifUpdateTime?: string } // 渡した項目だけ書く。ifUpdateTime を付けると、その時刻から変わっていないときだけ成功する
	| { type: 'delete'; path: string }

export async function fsBatch(env: FsEnv, ops: FsOp[]): Promise<void> {
	const docName = (path: string) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`
	const encodeFields = (data: FsData) => {
		const fields: Record<string, FsValue> = {}
		for (const [k, v] of Object.entries(data)) if (v !== undefined) fields[k] = encodeValue(v)
		return fields
	}
	const writes = ops.map((op) => {
		if (op.type === 'delete') return { delete: docName(op.path) }
		const fields = encodeFields(op.data)
		if (op.type === 'create') return { update: { name: docName(op.path), fields }, currentDocument: { exists: false } }
		return {
			update: { name: docName(op.path), fields },
			updateMask: { fieldPaths: Object.keys(fields).map((k) => '`' + k + '`') },
			...(op.ifUpdateTime ? { currentDocument: { updateTime: op.ifUpdateTime } } : {}),
		}
	})
	const res = await call(env, 'POST', `${base(env)}:commit`, { writes })
	if (!res.ok) throw new Error(`fsBatch: ${res.status} ${await res.text()}`)
}

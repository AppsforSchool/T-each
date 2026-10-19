// FirebaseのIDトークン（JWT）を、Googleの公開鍵で検証する。
// https://firebase.google.com/docs/auth/admin/verify-id-tokens の手順に沿った実装。

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

type Jwk = JsonWebKey & { kid?: string }
let cache: { keys: Jwk[]; fetchedAt: number } | null = null

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
	return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function getKeys(force = false): Promise<Jwk[]> {
	if (!force && cache && Date.now() - cache.fetchedAt < 3600_000) return cache.keys
	const res = await fetch(JWKS_URL)
	if (!res.ok) throw new Error('failed to fetch signing keys')
	const json = (await res.json()) as { keys: Jwk[] }
	cache = { keys: json.keys, fetchedAt: Date.now() }
	return cache.keys
}

export type FirebasePayload = {
	sub: string
	email?: string
	exp: number
	iat?: number
	aud: string
	iss: string
}

/** 正しいトークンなら中身を返し、そうでなければ null を返す。 */
export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebasePayload | null> {
	const parts = token.split('.')
	if (parts.length !== 3) return null
	const [h, p, s] = parts

	let header: { alg?: string; kid?: string }
	let payload: FirebasePayload
	try {
		header = JSON.parse(dec.decode(b64urlToBytes(h)))
		payload = JSON.parse(dec.decode(b64urlToBytes(p)))
	} catch {
		return null
	}
	if (header.alg !== 'RS256' || !header.kid) return null

	let jwk = (await getKeys()).find((k) => k.kid === header.kid)
	if (!jwk) jwk = (await getKeys(true)).find((k) => k.kid === header.kid) // 鍵が更新された場合
	if (!jwk) return null

	const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
		'verify',
	])
	const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), enc.encode(`${h}.${p}`))
	if (!ok) return null

	const now = Math.floor(Date.now() / 1000)
	if (payload.aud !== projectId) return null
	if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null
	if (typeof payload.exp !== 'number' || payload.exp < now) return null
	if (typeof payload.iat === 'number' && payload.iat > now + 300) return null
	if (typeof payload.sub !== 'string' || !payload.sub) return null
	return payload
}

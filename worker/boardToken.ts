// ボードへの接続用の、短命トークン（HMAC-SHA256署名）。
// Firebaseのログインと、セッションの参加者・状態を検証したあとに、Workerが発行する。
// ボードのDurable Objectは、Firestoreを読まず、このトークンの署名と期限だけを確かめる。

export type BoardClaims = {
	roomId: string // ボードのルームID（＝セッションID）
	userId: string
	readonly: boolean // ended のとき true
	exp: number // 有効期限（UNIX秒）
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64url(input: ArrayBuffer | Uint8Array): string {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
	let s = ''
	for (const b of bytes) s += String.fromCharCode(b)
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
	const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
	return Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0))
}

async function hmacKey(secret: string) {
	return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signBoardToken(claims: BoardClaims, secret: string): Promise<string> {
	const payload = b64url(enc.encode(JSON.stringify(claims)))
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
	return `${payload}.${b64url(sig)}`
}

/** 署名が正しく、期限内なら claims を返す。それ以外は null。 */
export async function verifyBoardToken(token: string, secret: string): Promise<BoardClaims | null> {
	const [payload, sig] = token.split('.')
	if (!payload || !sig) return null
	try {
		const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(payload))
		if (!ok) return null
		const claims = JSON.parse(dec.decode(b64urlDecode(payload))) as BoardClaims
		if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null
		return claims
	} catch {
		return null
	}
}

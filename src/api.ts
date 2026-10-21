import { API_BASE } from './config'
import { auth } from './firebase'

/** Workerが返したエラー。message は、そのまま画面に表示できる日本語。code は、画面での分岐に使う。 */
export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string
	) {
		super(message)
	}
}

/** ログイン中のユーザーのIDトークンを付けて、Workerを呼ぶ。 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const user = auth.currentUser
	if (!user) throw new ApiError(401, 'unauthorized', 'ログインが必要です')
	const headers = new Headers(init.headers)
	headers.set('Authorization', `Bearer ${await user.getIdToken()}`)

	let res: Response
	try {
		res = await fetch(`${API_BASE}${path}`, { ...init, headers })
	} catch {
		throw new ApiError(0, 'network', '通信できませんでした。接続を確認して、もう一度お試しください')
	}
	const text = await res.text()
	let json: { error?: string; message?: string } | null = null
	try {
		json = JSON.parse(text)
	} catch {
		// JSONではない応答は、そのまま扱わない
	}
	if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? `エラーが発生しました（${res.status}）`)
	return json as T
}

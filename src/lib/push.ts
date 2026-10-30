// プッシュ通知（OneSignal）の、画面側。
//   ・利用者の識別は、OneSignalの external_id ＝ T-eachのユーザーID（OneSignal.login）
//   ・App ID は、Workerから取得する（Secretに入れた値。公開してよい値）。未登録なら、通知なしで動く
//   ・通知の送信は、Workerだけが行う
import { apiFetch } from '../api'

type OneSignalApi = {
	init(options: object): Promise<void>
	login(externalId: string): Promise<void>
	logout(): Promise<void>
	Notifications: { requestPermission(): Promise<boolean> }
}
declare global {
	interface Window {
		OneSignalDeferred?: Array<(os: OneSignalApi) => void | Promise<void>>
	}
}

function withOneSignal<T>(fn: (os: OneSignalApi) => Promise<T>, timeoutMs: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`OneSignalの準備が終わりませんでした（${what}）`)), timeoutMs)
		window.OneSignalDeferred = window.OneSignalDeferred || []
		window.OneSignalDeferred.push(async (os) => {
			try {
				resolve(await fn(os))
			} catch (e) {
				reject(e)
			} finally {
				clearTimeout(timer)
			}
		})
	})
}

let initPromise: Promise<void> | null = null

/** OneSignalを初期化し、この端末を、ユーザーIDと紐づける。未設定なら、reject する（通知なしで動く）。 */
export function initPush(userId: string): Promise<void> {
	if (!initPromise) {
		initPromise = (async () => {
			const { appId } = await apiFetch<{ appId: string | null }>('/api/push-config', { method: 'POST' })
			if (!appId) throw new Error('unconfigured')
			const base = import.meta.env.BASE_URL // 例：/T-each/（サービスワーカーの範囲を、ここに収める）
			await withOneSignal(
				(os) =>
					os.init({
						appId,
						serviceWorkerPath: `${base}OneSignalSDKWorker.js`,
						serviceWorkerParam: { scope: base },
						allowLocalhostAsSecureOrigin: true,
						notifyButton: { enable: false },
					}),
				15_000,
				'初期化'
			)
		})().catch((e) => {
			initPromise = null // 次回、再試行できるようにする
			throw e
		})
	}
	return initPromise.then(() => withOneSignal((os) => os.login(userId), 10_000, 'ログイン'))
}

/** ログアウト前に呼ぶ（この端末に、前のユーザー宛の通知が届き続けないようにする） */
export async function logoutPush(): Promise<void> {
	if (!initPromise) return
	try {
		await withOneSignal((os) => os.logout(), 3000, 'ログアウト')
	} catch (e) {
		console.warn(e)
	}
}

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted'

const isIOS = () =>
	/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () =>
	window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

/** この端末の、通知の状態。iPhone・iPadは、ホーム画面に追加したアプリでしか、通知を受け取れない */
export function pushStatus(): PushStatus {
	if (isIOS() && !isStandalone()) return 'needs-install'
	if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
	return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default'
}

/** 「通知をオンにする」ボタンから呼ぶ。許可の画面が出る（ボタンを押した直後でないと、出ないことがある） */
export async function enablePush(userId: string): Promise<void> {
	await initPush(userId)
	await withOneSignal((os) => os.Notifications.requestPermission(), 60_000, '許可')
}

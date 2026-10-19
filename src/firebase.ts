// ★★ このファイルの Auth の初期化は、既存サイト（問題投稿・チャット）の firebase.js と同じにしてある。
//   同じオリジン（appsforschool.github.io）で動くサイトは、Authの初期化設定とSDKのバージョンを揃えないと、
//   片方を開いただけで全サイトがログアウトになる。変更するときは、必ず全サイト同時に変更すること。
//   ・SDKのバージョン：12.14.0（package.json で固定）
//   ・アプリ名は付けない（既定の "[DEFAULT]"）
//   ・getAuth() ではなく initializeAuth()。保存先は localStorage →（無理なら）sessionStorage → メモリ
import { initializeApp } from 'firebase/app'
import {
	browserLocalPersistence,
	browserSessionPersistence,
	getAuth,
	inMemoryPersistence,
	initializeAuth,
} from 'firebase/auth'
import { getFirestore, initializeFirestore } from 'firebase/firestore'
import { firebaseConfig } from './firebaseConfig'

export const app = initializeApp(firebaseConfig)

// 開発中のホットリロードで、この初期化が2回走っても落ちないようにしている
function createAuth() {
	try {
		return initializeAuth(app, {
			persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
		})
	} catch {
		return getAuth(app) // すでに初期化済み
	}
}
export const auth = createAuth()

// Firestoreの通信方式は、既存サイトの既定（ロングポーリング）に合わせる。
// 学校などのネットワークで、通常の方式の読み取りが数十秒止まることがあったための設定。
// 永続キャッシュ（IndexedDB）は、既存サイトと同じく使わない。
function createDb() {
	try {
		return initializeFirestore(app, { experimentalForceLongPolling: true })
	} catch {
		return getFirestore(app)
	}
}
export const db = createDb()

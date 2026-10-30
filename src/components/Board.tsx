import { useSync } from '@tldraw/sync'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	atom,
	computed,
	createUserId,
	type Editor,
	type TLAssetStore,
	type TLUserPreferences,
	type TLUserStore,
	Tldraw,
	UserRecordType,
	useTldrawCurrentUser,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { LIMITS } from '../../shared/limits'
import { apiFetch } from '../api'
import { useAuth } from '../auth'
import { API_BASE, TLDRAW_LICENSE_KEY } from '../config'
import { db } from '../firebase'
import { prepareImage } from '../lib/image'
import { useUser } from '../lib/users'

// カーソルの色は、サイトの配色に合わせる。依頼した側＝メインカラー（青緑）、依頼された側＝アクセントカラー（藍色）。
// （styles.css の --primary と --accent と、同じ色）
const CURSOR_COLOR = { requester: '#1f9d6b', tutor: '#3b6fe8' } as const
export type BoardRole = keyof typeof CURSOR_COLOR

/** 名前を読み込んでから、ボードを開く（接続したあとに、名前が変わって、つなぎ直しになるのを避ける） */
export function Board({ sessionId, role }: { sessionId: string; role: BoardRole }) {
	const { userId } = useAuth()
	const me = useUser(userId)
	if (!userId || !me)
		return (
			<div className="board-wrap">
				<p className="muted" style={{ padding: 16 }}>
					読み込み中…
				</p>
			</div>
		)
	return <BoardInner sessionId={sessionId} userId={userId} userName={me.name} role={role} />
}

/**
 * セッションのボード（tldraw sync）。
 * ・接続のたびに（再接続も含めて）、Workerから短命のトークンを取り直す。権限は、トークンの中身でサーバーが決める。
 * ・画像の追加は、端末側で縮小してから、Worker経由でImgBBにアップロードする（1セッション15枚まで）。
 * ・編集があったら、最終更新時刻を、1時間に1回まで書き込む（自動終了の基準）。
 */
function BoardInner({
	sessionId,
	userId,
	userName,
	role,
}: {
	sessionId: string
	userId: string
	userName: string
	role: BoardRole
}) {
	const getUri = useCallback(async () => {
		const { token } = await apiFetch<{ token: string }>(`/api/sessions/${sessionId}/board-token`, { method: 'POST' })
		const wsBase = API_BASE.replace(/^http/, 'ws') // https → wss、http → ws
		return `${wsBase}/api/board/${sessionId}/connect?token=${encodeURIComponent(token)}`
	}, [sessionId])

	const assets = useMemo<TLAssetStore>(
		() => ({
			upload: async (_asset, file) => {
				try {
					const prepared = await prepareImage(file as File)
					const fd = new FormData()
					fd.append('file', prepared)
					const r = await apiFetch<{ url: string }>(`/api/sessions/${sessionId}/images`, { method: 'POST', body: fd })
					return { src: r.url }
				} catch (e) {
					window.alert(e instanceof Error ? e.message : '画像を追加できませんでした')
					throw e
				}
			},
			resolve: (asset) => asset.props.src,
		}),
		[sessionId]
	)

	// カーソルに出す名前と色。tldraw v5 では、useSync に「users（現在の利用者を返す仕組み）」を渡す。
	// 利用者設定（画面のメニュー）と、同期で他の人に送る情報を、同じものにしておく。
	const [userPreferences, setUserPreferences] = useState<TLUserPreferences>(() => ({
		id: userId,
		name: userName,
		color: CURSOR_COLOR[role],
		locale: 'ja',
	}))
	const userPrefsAtom = useRef(atom('userPrefs', userPreferences)).current
	useEffect(() => {
		userPrefsAtom.set(userPreferences)
	}, [userPreferences, userPrefsAtom])

	const users: TLUserStore = useMemo(() => {
		const currentUser = computed('currentUser', () => {
			const p = userPrefsAtom.get()
			return UserRecordType.create({ id: createUserId(p.id), name: p.name ?? '', color: p.color ?? '' })
		})
		return { currentUser }
	}, [userPrefsAtom])

	const user = useTldrawCurrentUser({ userPreferences, setUserPreferences })
	const store = useSync({ uri: getUri, assets, users })

	// 編集があったら、最終更新時刻を書く（読み取り専用のときは、書かない）
	const lastWrite = useRef(0)
	const onMount = useCallback(
		(editor: Editor) =>
			editor.store.listen(
				() => {
					if (editor.getIsReadonly()) return
					const now = Date.now()
					if (now - lastWrite.current < LIMITS.activityWriteIntervalMs) return
					lastWrite.current = now
					updateDoc(doc(db, 'teach_sessions', sessionId), { lastActivityAt: serverTimestamp() }).catch(() => {})
				},
				{ source: 'user', scope: 'document' }
			),
		[sessionId]
	)

	return (
		<div className="board-wrap">
			<Tldraw store={store} user={user} licenseKey={TLDRAW_LICENSE_KEY} onMount={onMount} />
		</div>
	)
}

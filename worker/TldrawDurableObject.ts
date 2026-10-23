import {
	DurableObjectSqliteSyncWrapper,
	type SessionStateSnapshot,
	SQLiteSyncStorage,
	TLSocketRoom,
} from '@tldraw/sync-core'
import { createTLSchema, defaultShapeSchemas, type TLRecord } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error, type IRequest } from 'itty-router'
import { fetchImageInfo } from './imageSize'

// 独自の図形を足すときは、ここに追加する（画面側の useSync にも、同じものを渡す必要がある）
const schema = createTLSchema({ shapes: { ...defaultShapeSchemas } })

interface SocketAttachment {
	sessionId: string // tldrawの接続ごとのID（T-eachのセッションIDではない）
	snapshot: SessionStateSnapshot | null
}

function getAttachment(ws: WebSocket): SocketAttachment | null {
	const attachment = ws.deserializeAttachment() as SocketAttachment | null
	return attachment?.sessionId ? attachment : null
}

// 'a1', 'a2', … 'a9', 'aA', … の順に、並び順を表すキー（tldrawの図形の index）を作る
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const indexKey = (i: number) => 'a' + BASE62[Math.min(i + 1, BASE62.length - 1)]

// プレーンな文字列から、tldrawのリッチテキスト（TipTap形式）を作る
function toRichTextDoc(text: string) {
	return {
		type: 'doc',
		content: text.split('\n').map((line) =>
			line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
		),
	}
}

export type InitBoardArgs = { text: string; comment: string; imageUrls: string[] }

/**
 * ボード1つにつき、Durable Objectを1つ使う（ルームID＝T-eachのセッションID）。
 * ボードのデータは、Durable Object内蔵のSQLiteに保存される。
 */
export class TldrawDurableObject extends DurableObject {
	private room: TLSocketRoom<TLRecord, void> | null = null
	private readonly sessionIdToWs = new Map<string, WebSocket>()

	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never)
		// 5秒ごとのping には、DOを起こさずに、Cloudflare側で応答する
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
	}

	private getOrCreateRoom(): TLSocketRoom<TLRecord, void> {
		if (!this.room) {
			const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage)
			const storage = new SQLiteSyncStorage<TLRecord>({ sql })
			this.room = new TLSocketRoom<TLRecord, void>({
				schema,
				storage,
				clientTimeout: Infinity, // 接続の維持は、Cloudflare側に任せる
				onSessionSnapshot: (sessionId, snapshot) => {
					const ws = this.sessionIdToWs.get(sessionId)
					if (ws) ws.serializeAttachment({ sessionId, snapshot })
				},
			})
			// ハイバネーションを生き延びた接続を、復帰させる
			for (const ws of this.ctx.getWebSockets()) {
				const a = getAttachment(ws)
				if (!a?.snapshot) continue
				this.room.handleSocketResume({ sessionId: a.sessionId, socket: ws, snapshot: a.snapshot })
			}
		}
		return this.room
	}

	// ------------------------------------------------------------------
	// Workerから、直接呼ばれるメソッド（RPC）
	// ------------------------------------------------------------------

	/**
	 * 承認時の初期配置。問題文を左に、画像を右に縦に並べる。
	 * 二重配置を防ぐため、一度配置したら印を付け、2回目以降は何もしない（何度呼んでも同じ結果）。
	 */
	async initBoard(args: InitBoardArgs): Promise<{ initialized: boolean }> {
		if (await this.ctx.storage.get('boardInitialized')) return { initialized: false }

		// 画像の大きさは、サーバー側で読み取る（取得に失敗した画像は、既定の大きさで置く）
		const infos = await Promise.all(args.imageUrls.map((u) => fetchImageInfo(u)))

		const room = this.getOrCreateRoom()
		await room.updateStore((store) => {
			// 空のルームには、ドキュメントとページが無いので、無ければ作る
			if (!store.get('document:document' as never))
				store.put({ id: 'document:document', typeName: 'document', gridSize: 10, name: '', meta: {} } as unknown as TLRecord)
			if (!store.get('page:page' as never))
				store.put({ id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} } as unknown as TLRecord)

			let order = 0

			// ---- 問題文（＋コメント）：左 ----
			const body = [args.text.trim(), args.comment.trim() ? `【コメント】${args.comment.trim()}` : '']
				.filter(Boolean)
				.join('\n\n')
			if (body) {
				store.put({
					id: 'shape:init_text',
					typeName: 'shape',
					type: 'text',
					x: 0,
					y: 0,
					rotation: 0,
					index: indexKey(order++),
					parentId: 'page:page',
					isLocked: false,
					opacity: 1,
					meta: {},
					props: {
						color: 'black',
						size: 'm',
						w: 520,
						font: 'draw',
						textAlign: 'start',
						autoSize: false,
						scale: 1,
						richText: toRichTextDoc(body),
					},
				} as unknown as TLRecord)
			}

			// ---- 画像：右に、縦に並べる（枠 560×420 に収まるよう、比率を保って縮小） ----
			let y = 0
			args.imageUrls.forEach((url, i) => {
				const info = infos[i]
				const scale = Math.min(1, 560 / info.w, 420 / info.h)
				const w = Math.max(1, Math.round(info.w * scale))
				const h = Math.max(1, Math.round(info.h * scale))
				const assetId = `asset:init_image_${i}`
				store.put({
					id: assetId,
					typeName: 'asset',
					type: 'image',
					meta: {},
					props: { w: info.w, h: info.h, name: `image-${i + 1}`, isAnimated: info.animated, mimeType: info.mime, src: url },
				} as unknown as TLRecord)
				store.put({
					id: `shape:init_image_${i}`,
					typeName: 'shape',
					type: 'image',
					x: 600,
					y,
					rotation: 0,
					index: indexKey(order++),
					parentId: 'page:page',
					isLocked: false,
					opacity: 1,
					meta: {},
					props: { w, h, playing: true, url: '', assetId, crop: null, flipX: false, flipY: false, altText: '' },
				} as unknown as TLRecord)
				y += h + 24
			})
		})

		await this.ctx.storage.put('boardInitialized', true)
		return { initialized: true }
	}

	/** 全接続を切る。クライアントは自動で再接続し、そのときに、新しいトークン（新しい権限）を取り直す。 */
	async kickAll(): Promise<{ closed: number }> {
		let closed = 0
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.close(1000, 'permission changed')
				closed++
			} catch {
				// すでに閉じている接続は無視
			}
		}
		return { closed }
	}

	/** ボードのデータを、すべて削除する（何度呼んでも同じ結果）。自動削除の処理（M7）で使う。 */
	async deleteBoard(): Promise<{ deleted: boolean }> {
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.close(1000, 'room deleted')
			} catch {
				// 無視
			}
		}
		this.sessionIdToWs.clear()
		this.room?.close()
		this.room = null
		await this.ctx.storage.deleteAll()
		return { deleted: true }
	}

	// ------------------------------------------------------------------
	// WebSocketの接続
	// ------------------------------------------------------------------

	private readonly router = AutoRouter({ catch: (e) => error(e) }).get('/api/board/:roomId/connect', (request) =>
		this.handleConnect(request)
	)

	fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	async handleConnect(request: IRequest) {
		const sessionId = request.query.sessionId as string
		if (!sessionId) return error(400, 'Missing sessionId')
		// 権限は、Workerがトークンから決めて、このヘッダーで渡す（クライアントは偽装できない）
		const isReadonly = request.headers.get('x-board-readonly') === '1'

		const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
		this.ctx.acceptWebSocket(serverWebSocket)
		serverWebSocket.serializeAttachment({ sessionId, snapshot: null } satisfies SocketAttachment)
		this.getOrCreateRoom().handleSocketConnect({ sessionId, socket: serverWebSocket, isReadonly })
		return new Response(null, { status: 101, webSocket: clientWebSocket })
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const a = getAttachment(ws)
		if (!a) return
		this.sessionIdToWs.set(a.sessionId, ws)
		this.getOrCreateRoom().handleSocketMessage(a.sessionId, message)
	}

	override async webSocketClose(ws: WebSocket) {
		this.handleWebSocketEnd(ws, 'handleSocketClose')
	}

	override async webSocketError(ws: WebSocket) {
		this.handleWebSocketEnd(ws, 'handleSocketError')
	}

	private handleWebSocketEnd(ws: WebSocket, method: 'handleSocketClose' | 'handleSocketError') {
		const a = getAttachment(ws)
		if (!a) return
		this.sessionIdToWs.delete(a.sessionId)
		const room = this.getOrCreateRoom()
		// ハイバネーション中だった接続は、いったん復帰させてから閉じる（他の人に、退出を伝えるため）
		if (a.snapshot && !room.getSessionSnapshot(a.sessionId)) {
			room.handleSocketResume({ sessionId: a.sessionId, socket: ws, snapshot: a.snapshot })
		}
		room[method](a.sessionId)
	}
}

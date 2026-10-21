// Firestoreに保存するデータの形。画面（src）とWorker（worker）の両方から読み込む。
// 時刻の型は、画面では Firestore の Timestamp、Workerでは Date になるため、型引数 T で切り替える。
//   画面：SessionDoc<Timestamp>   Worker：SessionDoc<Date>

/** 依頼とセッションの状態。
 *  requested：依頼済み（先生の返答待ち）  active：承認済み・活動中
 *  declined ：拒否された（自動拒否を含む）  ended：終了（取り下げを含む） */
export type SessionStatus = 'requested' | 'active' | 'declined' | 'ended'

/** 依頼時に保存する、元の問題のスナップショット。元の問題が、あとで編集・削除されても残る。 */
export type SessionSource<T = Date> = {
	problemId: string | null // 問題投稿サイトの問題ID（参照用。内容の正しさは確認しない）
	text: string // 問題文
	comment: string // 依頼者のコメント
	imageUrls: string[] // 引き継いだ画像（ImgBB）と、依頼時に追加した画像のURL
	createdAt?: T
}

/** teach_sessions/{sessionId} — 参加者だけが読める。書き込みは基本的にWorkerだけ。 */
export type SessionDoc<T = Date> = {
	requesterId: string // 依頼した人（users_random のID）
	tutorId: string // 依頼された人
	memberIds: [string, string] // [requesterId, tutorId]。ルールでの参加者の判定と、一覧の検索（array-contains）に使う

	status: SessionStatus
	source: SessionSource<T>

	createdAt: T
	updatedAt: T
	/** 最後に、チャット・通話・ボード編集があった時刻。active の自動終了の基準。 */
	lastActivityAt: T
	lastMessageAt: T | null
	/** 参加者ごとの既読時刻。自分の分だけ、画面から書き込める。 */
	lastRead: Record<string, T>

	/** 承認された時刻。これがあるセッションだけ、終了後に再開できる。 */
	approvedAt: T | null
	declinedAt: T | null
	declineReason: string | null
	autoDeclined: boolean
	endedAt: T | null
	endedBy: string | null // 手動終了・取り下げをした人。自動終了のときは null
	autoEnded: boolean
	/** 削除予定日。ended / declined になったときに設定し、再開したら null に戻す。 */
	deleteAt: T | null

	boardInitialized: boolean // ボードの初期配置が済んだか（二重配置の防止）
	imageCount: number // このセッションで追加した画像の枚数（上限の判定用）
}

/** システムメッセージの種類。チャットに、出来事として表示する。 */
export type SystemKind =
	| 'approved'
	| 'declined'
	| 'autoDeclined'
	| 'withdrawn'
	| 'ended'
	| 'autoEnded'
	| 'resumed'
	| 'missedCall'
	| 'callEnded'
	| 'callDisconnected'

/** teach_sessions/{sessionId}/messages/{messageId} — 書き込みはWorkerだけ（偽造できない）。 */
export type MessageDoc<T = Date> = {
	type: 'message' | 'system'
	senderId: string | null // system のときは null
	text: string
	kind: SystemKind | null // type が system のときだけ
	mentions?: string[] // 将来の自習室で、呼びかけの通知に使う余地
	createdAt: T
}

/** teach_sessions/{sessionId}/secrets/images — ルールで一切許可しない。Workerだけが読み書きする。
 *  ImgBBの delete_url は、持っていれば誰でも画像を削除できるため、参加者が読める文書には置かない。 */
export type SessionSecrets = {
	images: { url: string; deleteUrl: string; addedBy: string; addedAt: Date }[]
}

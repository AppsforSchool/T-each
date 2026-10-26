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
	/** 最後のメッセージ（システムメッセージを含む）を送った人。一覧の「新着」の判定に使う。古いデータには無い（null として扱う）。 */
	lastMessageBy: string | null
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

	/** 直近の通話の状態。Workerだけが書く。一度も通話していないセッションには無い（null として扱う）。 */
	call?: CallState<T> | null
}

/** 通話の状態。ringing：呼び出し中（最大60秒） connected：通話中
 *  終端：ended（終了）／rejected（拒否）／missed（時間切れ）／canceled（発信者の取り消し）／busy（話中） */
export type CallStatus = 'ringing' | 'connected' | 'ended' | 'rejected' | 'missed' | 'canceled' | 'busy'

export type CallState<T = Date> = {
	id: string // 通話ごとのID。シグナリング（signals）の絞り込みに使う
	status: CallStatus
	callerId: string
	calleeId: string
	startedAt: T
	answeredAt: T | null
	endedAt: T | null
	endedBy: string | null
	endReason: 'disconnected' | null // 再接続できずに終了したとき
	/** 通話中に、参加者の画面が定期的に更新する。これが長く止まった通話は、放置されたものとして扱う。 */
	lastPingAt: T
}

/** teach_sessions/{sessionId}/signals/{signalId} — WebRTCの接続情報。参加者が作成のみ可能（更新・削除は不可）。 */
export type SignalDoc<T = Date> = {
	callId: string
	from: string
	to: string
	type: 'sdp' | 'ice' | 'restart'
	data: string // JSON文字列（sdp: RTCSessionDescriptionInit／ice: RTCIceCandidateInit／restart: {}）
	createdAt: T
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

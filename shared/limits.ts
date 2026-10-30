// 制限値。仕様で決めた値のうち、数値のものをここにまとめる。（仮）は、運用しながら調整する。
export const LIMITS = {
	// 依頼
	maxPendingRequestsPerUser: 10, // 返答待ち（requested）の依頼を、1人が同時に持てる数（仮）
	maxPendingRequestsPerPair: 1, // 同じ相手への返答待ちは、向きごとに1件まで
	commentMaxChars: 500, // 依頼時のコメント（仮）
	sourceTextMaxChars: 5000, // 依頼に付ける問題文（仮）
	declineReasonMaxChars: 500, // 拒否理由（任意の自由記述）（仮）

	// チャット
	chatMessageMaxChars: 2000, // 1メッセージ（仮）
	chatRateLimit: { max: 30, windowSeconds: 60 }, // 1人あたりの送信回数の上限（仮）
	activityWriteIntervalMs: 60 * 60 * 1000, // ボードの編集で、最終更新時刻（lastActivityAt）を書き込む間隔の下限（仮）
	readMarkIntervalMs: 3000, // 既読時刻を書き込む間隔の下限（仮）
	chatLoadCount: 100, // 画面に読み込む、直近のメッセージ数（仮）
	// 画像
	maxImagesPerRequest: 3, // 依頼の作成時に、新しく追加できる枚数
	maxImagesPerSession: 15, // 1セッション全体で追加できる枚数（依頼時の分も含む。ImgBB参照の引き継ぎ画像は含まない）（仮）
	imageMaxBytes: 5 * 1024 * 1024, // 端末側で縮小したあとの、1枚の上限（仮）
	workerImageMaxBytes: 10 * 1024 * 1024, // Workerが、これを超えるものを拒否する
	imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
	imageMaxLongSide: 2000, // 端末側で縮小するときの、長辺の上限（px）
	maxImportedImages: 10, // 問題投稿サイトなどから引き継ぐ画像（ImgBB参照）の上限（仮）
	importedImageHosts: ['i.ibb.co', 'ibb.co'], // 引き継ぎを許可する画像のホスト
	maxUnattachedUploads: 10, // まだ依頼に付けていないアップロードを、同時に持てる数（仮）
	unattachedUploadHours: 24, // 上の数に数える期間（これより古い未使用分は、数えない）

	// 期間（日）
	autoDeclineDays: 30, // 返答がない依頼は、作成から30日で、自動的に拒否扱いになる（仮）
	autoEndDays: 30, // active のセッションは、最終更新から30日で、自動的に終了する（仮）
	autoDeleteDays: 30, // ended / declined は、30日後に削除する（仮）

	// 通話
	ringSeconds: 60, // 呼び出し時間（仮）
	reconnectSeconds: 30, // 通話中の切断から、再接続をあきらめるまでの時間（仮）
	pushPreviewChars: 60, // 通知に出す、メッセージの文字数
	ringGraceSeconds: 3, // 時間切れの判定の、時計のずれの許容（画面とWorkerで、時計が少しずれていても大丈夫なように）
	callPingSeconds: 30, // 通話中に、画面がWorkerへ生存を知らせる間隔
	callStaleSeconds: 90, // 通話中の通知がこの時間なければ、放置された通話として扱う（話中の判定から外す）
} as const

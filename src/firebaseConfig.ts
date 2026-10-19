// 既存サイト（問題投稿・チャット）と同じ値。公開されている値で、秘密の情報ではない。
// ★ apiKey は、ログイン情報の保存キー（firebase:authUser:<apiKey>:[DEFAULT]）に使われる。
//   既存サイトと一字一句同じでなければ、ログイン状態を共有できない。書き換えないこと。
// ★ appId は既存の問題投稿サイトのものを借用している（appId はログイン情報の保存キーに影響しない）。
export const firebaseConfig = {
	apiKey: 'AIzaSyAqIiNj0N4WruPSOkWbeo5gxzsNyeMkuLo',
	authDomain: 'appsforschool-study.firebaseapp.com',
	projectId: 'appsforschool-study',
	storageBucket: 'appsforschool-study.firebasestorage.app',
	messagingSenderId: '740735293440',
	appId: '1:740735293440:web:a1363adbab57f1ceec60e5',
}

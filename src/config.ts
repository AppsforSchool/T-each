// Workerの公開URL。ローカル開発では .env.development の VITE_API_BASE が使われる。
export const API_BASE: string =
	import.meta.env.VITE_API_BASE ?? 'https://t-each-api.sugaku496.workers.dev'

// 既存サイトと同じ。画面ではIDを入力し、内部では ID@appsforschool.com に変換する。
export const LOGIN_DOMAIN = 'appsforschool.com'

// tldrawの趣味ライセンスのキー（有効期限 2027-10-20、対象ドメイン *.appsforschool.github.io）。
// 画面のコードに含まれる値で、秘密の情報ではない。localhost（開発中）では、なくても動く。
export const TLDRAW_LICENSE_KEY =
	'tldraw-------2027-10-20/WyJJNFR3UWs2QyIsWyIqLmFwcHNmb3JzY2hvb2wuZ2l0aHViLmlvIl0sNzMsIjIwMjctMTAtMjAiXQ.DEYZ9S56nx6w5GXD6LFhXYOqf1DJS/D6g9gaS+UZi1hTkOqtN5zUGTz4WKzTec7q8sjmHP3j49ukeV9RgccVHg'

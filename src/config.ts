// Workerの公開URL。ローカル開発では .env.development の VITE_API_BASE が使われる。
export const API_BASE: string =
	import.meta.env.VITE_API_BASE ?? 'https://t-each-api.sugaku496.workers.dev'

// 既存サイトと同じ。画面ではIDを入力し、内部では ID@appsforschool.com に変換する。
export const LOGIN_DOMAIN = 'appsforschool.com'

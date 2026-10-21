// サービスアカウントの鍵（key.json）から、ローカル開発用の設定ファイル（.dev.vars）を作る。
// すでに .dev.vars があれば、FIREBASE_SERVICE_ACCOUNT 以外の行（IMGBB_API_KEY など）は、そのまま残す。
// 使い方： npm run make-dev-vars   （key.json をプロジェクト直下に置いてから実行）
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] ?? 'key.json'
const json = JSON.stringify(JSON.parse(readFileSync(src, 'utf8'))) // 1行にする
if (json.includes("'")) throw new Error("鍵のJSONに ' が含まれているため、この方法は使えません")

const keep = existsSync('.dev.vars')
	? readFileSync('.dev.vars', 'utf8')
			.split(/\r?\n/)
			.filter((l) => l.trim() && !l.startsWith('FIREBASE_SERVICE_ACCOUNT='))
	: []
writeFileSync('.dev.vars', [...keep, `FIREBASE_SERVICE_ACCOUNT='${json}'`].join('\n') + '\n')
console.log('.dev.vars を更新しました')

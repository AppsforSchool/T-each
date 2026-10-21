import { error } from 'itty-router'

/** 画面に見せられる形のエラー応答。code は画面の分岐用、message は、そのまま表示できる日本語。 */
export const fail = (status: number, code: string, message: string) => error(status, { error: code, message })

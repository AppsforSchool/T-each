import type { SessionDoc, SessionStatus } from '../../shared/types'
import { apiFetch } from '../api'

export const STATUS_LABEL: Record<SessionStatus, string> = {
	requested: '返答待ち',
	active: '進行中',
	declined: '拒否',
	ended: '終了',
}

export type SessionAction = 'approve' | 'decline' | 'withdraw' | 'end' | 'resume'

export function runSessionAction(sessionId: string, action: SessionAction, body: object = {}) {
	return apiFetch<{ ok: true; status: SessionStatus }>(`/api/sessions/${sessionId}/${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

/** 相手のID */
export const partnerIdOf = (s: Pick<SessionDoc, 'requesterId' | 'tutorId'>, me: string | null) =>
	s.requesterId === me ? s.tutorId : s.requesterId

/** 自分の役割。依頼者＝教わる側、先生＝教える側 */
export const roleLabelOf = (s: Pick<SessionDoc, 'requesterId'>, me: string | null) =>
	s.requesterId === me ? '教わる' : '教える'

/** 一覧・見出しに出す題名。問題文の最初の行（無ければ、コメント、画像だけなら、その旨） */
export function sessionTitle(s: { source: { text?: string; comment?: string } }): string {
	const first = (s.source.text || s.source.comment || '').split('\n').find((l) => l.trim())?.trim()
	if (!first) return '（画像のみ）'
	return first.length > 40 ? first.slice(0, 40) + '…' : first
}

/** 状態の表示名。依頼された側には、「返答待ち」でなく「要対応」と出す */
export const statusLabelOf = (s: Pick<SessionDoc, 'status' | 'tutorId'>, me: string | null) =>
	s.status === 'requested' && s.tutorId === me ? '要対応' : STATUS_LABEL[s.status]

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

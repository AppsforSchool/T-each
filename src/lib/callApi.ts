import type { CallStatus } from '../../shared/types'
import { apiFetch } from '../api'

export type CallAction = 'start' | 'answer' | 'reject' | 'cancel' | 'timeout' | 'end' | 'ping'

export type CallResult = { ok: true; status: CallStatus; callId?: string }

/** 通話の状態を変える（すべて、Worker経由） */
export function callRequest(sessionId: string, action: CallAction, body: object = {}) {
	return apiFetch<CallResult>(`/api/sessions/${sessionId}/call/${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

/** ICEサーバーの設定は、Workerから取得する（TURNを足すときも、Workerの変更だけで済む） */
export function fetchIceServers() {
	return apiFetch<{ iceServers: RTCIceServer[] }>('/api/ice-servers', { method: 'POST' })
}

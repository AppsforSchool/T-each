import type { IRequest } from 'itty-router'
import { LIMITS } from '../shared/limits'
import type { SessionStatus, SystemKind } from '../shared/types'
import { type BoardEnv, ensureBoard, kickBoard } from './board'
import type { FsData } from './firestore'
import { fsBatch, fsGet } from './firestore'
import { fail } from './http'

const ACTIONS = ['approve', 'decline', 'withdraw', 'end', 'resume'] as const
type SessionAction = (typeof ACTIONS)[number]

const DAY = 86_400_000
const KIND: Record<SessionAction, SystemKind> = {
	approve: 'approved',
	decline: 'declined',
	withdraw: 'withdrawn',
	end: 'ended',
	resume: 'resumed',
}

/**
 * POST /api/sessions/:id/:action — セッションの状態を変える。
 * 誰が・どの状態から・何にできるかは、ここ1か所で決める（画面やFirestoreのルールには任せない）。
 */
export async function sessionAction(request: IRequest, env: BoardEnv, who: { userId: string }): Promise<Response> {
	const sessionId = String(request.params.id ?? '')
	const action = String(request.params.action ?? '') as SessionAction
	if (!(ACTIONS as readonly string[]).includes(action)) return fail(404, 'unknown_action', '不明な操作です')
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) return fail(404, 'not_found', 'セッションが見つかりません')

	const doc = await fsGet(env, `teach_sessions/${sessionId}`)
	const s = doc?.data
	const memberIds = Array.isArray(s?.memberIds) ? (s!.memberIds as string[]) : []
	// 参加者以外には、セッションの存在も知らせない
	if (!doc || !s || !memberIds.includes(who.userId)) return fail(404, 'not_found', 'セッションが見つかりません')

	const status = s.status as SessionStatus
	const isTutor = s.tutorId === who.userId
	const isRequester = s.requesterId === who.userId
	const forbidden = () => fail(403, 'forbidden', 'この操作は、できません')
	const invalidState = () =>
		fail(409, 'invalid_state', '状態が変わったため、この操作はできません。画面を更新してください')

	const now = new Date()
	const deleteAt = new Date(now.getTime() + LIMITS.autoDeleteDays * DAY)
	let update: FsData
	let text = ''

	switch (action) {
		case 'approve':
			if (!isTutor) return forbidden()
			if (status !== 'requested') return invalidState()
			// ボードの準備（初期配置）は、承認と一体で行う。失敗したら、承認しない。二重配置は、Durable Object側で防ぐ
			try {
				await ensureBoard(env, sessionId, s)
			} catch (e) {
				console.error('ensureBoard failed', e)
				return fail(502, 'board_failed', 'ボードを準備できませんでした。もう一度お試しください')
			}
			update = { status: 'active', approvedAt: now, lastActivityAt: now, boardInitialized: true }
			break

		case 'decline': {
			if (!isTutor) return forbidden()
			if (status !== 'requested') return invalidState()
			const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
			const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
			if (reason.length > LIMITS.declineReasonMaxChars)
				return fail(400, 'reason_too_long', `理由は${LIMITS.declineReasonMaxChars}文字までです`)
			text = reason
			update = { status: 'declined', declinedAt: now, declineReason: reason || null, autoDeclined: false, deleteAt }
			break
		}

		case 'withdraw': // 依頼者が、返答待ちの依頼を取り下げる
			if (!isRequester) return forbidden()
			if (status !== 'requested') return invalidState()
			update = { status: 'ended', endedAt: now, endedBy: who.userId, autoEnded: false, deleteAt }
			break

		case 'end': // 終了できるのは依頼者だけ
			if (!isRequester) return forbidden()
			if (status !== 'active') return invalidState()
			update = { status: 'ended', endedAt: now, endedBy: who.userId, autoEnded: false, deleteAt }
			break

		case 'resume': // 承認されたことがあるセッションだけ、どちらからでも再開できる
			if (status !== 'ended' || s.approvedAt == null) return invalidState()
			update = {
				status: 'active',
				endedAt: null,
				endedBy: null,
				autoEnded: false,
				deleteAt: null, // 削除予定を取り消す。次に終了したときに、あらためて設定する
				lastActivityAt: now,
			}
			break
	}

	try {
		await fsBatch(env, [
			{
				type: 'set',
				path: `teach_sessions/${sessionId}`,
				data: { ...update, updatedAt: now, lastMessageAt: now, lastMessageBy: who.userId },
				ifUpdateTime: doc.updateTime, // 同時に別の操作が入っていたら、失敗させる
			},
			{
				type: 'create',
				path: `teach_sessions/${sessionId}/messages/${crypto.randomUUID()}`,
				data: { type: 'system', senderId: who.userId, text, kind: KIND[action], createdAt: now },
			},
		])
	} catch (e) {
		console.error(e)
		return invalidState()
	}
	// 権限が変わる（終了で読み取り専用、再開で書き込み可）ので、接続中のボードを切って、再接続させる
	if ((action === 'end' || action === 'resume') && s.boardInitialized === true) await kickBoard(env, sessionId)

	// 終了・再開で、ボードの権限が変わる。接続を切って、再接続（新しいトークン）を促す。

	return Response.json({ ok: true, status: update.status })
}

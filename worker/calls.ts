import type { IRequest } from 'itty-router'
import { LIMITS } from '../shared/limits'
import type { CallState, SystemKind } from '../shared/types'
import type { FsData, FsEnv } from './firestore'
import { fsBatch, fsGet, fsQuery } from './firestore'
import { fail } from './http'

// 通話の状態の変更は、すべてここ（Worker）を通す。誰が・どの状態から・何にできるかは、ここ1か所で決める。
// 接続情報（SDP・ICE候補）は、画面がFirestoreの signals に直接書く（ここでは扱わない。不要になった分の削除だけ行う）。

const ACTIONS = ['start', 'answer', 'reject', 'cancel', 'timeout', 'end', 'ping'] as const
type CallAction = (typeof ACTIONS)[number]

type Call = CallState<Date>

/** 画面に渡すICEサーバーの設定。TURNを足すときは、ここだけを変える（現行の無料枠と条件を、公式で確認してから）。 */
const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]

/** POST /api/ice-servers — ログインしている人に、ICEサーバーの設定を返す。 */
export async function iceServers(): Promise<Response> {
	return Response.json({ iceServers: ICE_SERVERS })
}

function readCall(v: unknown): Call | null {
	if (!v || typeof v !== 'object') return null
	const c = v as Partial<Call>
	if (typeof c.id !== 'string' || typeof c.status !== 'string') return null
	return c as Call
}

/** いま生きている通話か。呼び出し中は、時間切れまで。通話中は、画面からの生存通知が、途切れていないこと。 */
export function isLiveCall(call: Call | null, nowMs: number): boolean {
	if (!call) return false
	if (call.status === 'ringing') return nowMs - call.startedAt.getTime() < (LIMITS.ringSeconds + LIMITS.ringGraceSeconds) * 1000
	if (call.status === 'connected') return nowMs - call.lastPingAt.getTime() < LIMITS.callStaleSeconds * 1000
	return false
}

const isTerminal = (c: Call) => c.status !== 'ringing' && c.status !== 'connected'

/** 指定した人が、別のセッションで通話中（または呼び出し中）か。 */
async function isBusyElsewhere(env: FsEnv, userId: string, exceptSessionId: string, nowMs: number): Promise<boolean> {
	// 1人が関わるセッションは多くない前提で、全件を取って、メモリ上で判定する
	const rows = await fsQuery(env, 'teach_sessions', [['memberIds', userId, 'ARRAY_CONTAINS']], 200)
	return rows.some((r) => r.id !== exceptSessionId && isLiveCall(readCall(r.data.call), nowMs))
}

/** 通話が終わったあと、使い終わった接続情報を消す（残っても、セッションの削除時に消える） */
async function cleanupSignals(env: FsEnv, sessionId: string, callId: string): Promise<void> {
	try {
		const rows = await fsQuery(env, 'signals', [['callId', callId]], 400, `teach_sessions/${sessionId}`)
		if (rows.length === 0) return
		await fsBatch(
			env,
			rows.map((r) => ({ type: 'delete' as const, path: `teach_sessions/${sessionId}/signals/${r.id}` }))
		)
	} catch (e) {
		console.error('cleanupSignals failed', e)
	}
}

const durationText = (ms: number) => {
	const sec = Math.max(0, Math.round(ms / 1000))
	const m = Math.floor(sec / 60)
	return m > 0 ? `${m}分${sec % 60}秒` : `${sec}秒`
}

type Plan = {
	call: Call
	message?: { kind: SystemKind; senderId: string; text: string }
	touchActivity?: boolean
	cleanupCallId?: string[] // 終わったあとに、接続情報を消す通話ID
	res: Response
}

/** POST /api/sessions/:id/call/:action */
export async function callAction(
	request: IRequest,
	env: FsEnv,
	who: { userId: string },
	ctx: ExecutionContext
): Promise<Response> {
	const sessionId = String(request.params.id ?? '')
	const action = String(request.params.action ?? '') as CallAction
	if (!(ACTIONS as readonly string[]).includes(action)) return fail(404, 'unknown_action', '不明な操作です')
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) return fail(404, 'not_found', 'セッションが見つかりません')
	const body = (await request.json().catch(() => ({}))) as { reason?: unknown; callId?: unknown }
	const reqCallId = typeof body.callId === 'string' ? body.callId : null
	const disconnected = body.reason === 'disconnected'

	// セッション文書は、チャットの既読などでも更新される。同時に更新が入って失敗したら、読み直して、数回やり直す
	for (let attempt = 0; attempt < 3; attempt++) {
		const doc = await fsGet(env, `teach_sessions/${sessionId}`)
		const s = doc?.data
		const memberIds = Array.isArray(s?.memberIds) ? (s!.memberIds as string[]) : []
		// 参加者以外には、セッションの存在も知らせない
		if (!doc || !s || !memberIds.includes(who.userId)) return fail(404, 'not_found', 'セッションが見つかりません')

		const me = who.userId
		const partnerId = memberIds.find((m) => m !== me) as string
		const now = new Date()
		const nowMs = now.getTime()
		const call = readCall(s.call)
		const invalidState = () => fail(409, 'invalid_state', '通話の状態が変わりました。画面を更新してください')
		const forbidden = () => fail(403, 'forbidden', 'この操作は、できません')
		// 古い画面からの操作が、新しい通話に作用しないように、通話IDが指定されていれば、一致を確認する
		if (action !== 'start' && reqCallId && call && call.id !== reqCallId) return invalidState()

		let plan: Plan
		switch (action) {
			case 'start': {
				if (s.status !== 'active')
					return fail(409, 'not_active', 'このセッションでは、いま通話できません（終了している場合は、再開してください）')
				if (call && isLiveCall(call, nowMs)) {
					return call.callerId === me
						? fail(409, 'already_calling', 'すでに呼び出し中、または通話中です')
						: fail(409, 'incoming_call', '相手から着信しています。応答してください')
				}
				const [meBusy, partnerBusy] = await Promise.all([
					isBusyElsewhere(env, me, sessionId, nowMs),
					isBusyElsewhere(env, partnerId, sessionId, nowMs),
				])
				if (meBusy) return fail(409, 'you_busy', '別の通話中です。先に、その通話を終えてください')
				const base: Call = {
					id: crypto.randomUUID(),
					status: 'ringing',
					callerId: me,
					calleeId: partnerId,
					startedAt: now,
					answeredAt: null,
					endedAt: null,
					endedBy: null,
					endReason: null,
					lastPingAt: now,
				}
				const cleanupCallId = call ? [call.id] : []
				if (partnerBusy) {
					// 話中：発信者に、すぐに知らせる。チャットには、不在着信を残す
					plan = {
						call: { ...base, status: 'busy', endedAt: now },
						message: { kind: 'missedCall', senderId: me, text: '' },
						cleanupCallId,
						res: Response.json({ ok: true, status: 'busy', callId: base.id }),
					}
				} else {
					// M6：ここで、着信側へプッシュ通知を送る
					plan = {
						call: base,
						touchActivity: true,
						cleanupCallId,
						res: Response.json({ ok: true, status: 'ringing', callId: base.id }),
					}
				}
				break
			}

			case 'answer': {
				if (!call || call.calleeId !== me) return call ? forbidden() : invalidState()
				if (call.status !== 'ringing' || s.status !== 'active') return invalidState()
				if (!isLiveCall(call, nowMs)) return fail(409, 'expired', '呼び出しの時間が過ぎました')
				plan = {
					call: { ...call, status: 'connected', answeredAt: now, lastPingAt: now },
					touchActivity: true,
					res: Response.json({ ok: true, status: 'connected', callId: call.id }),
				}
				break
			}

			case 'reject': {
				if (!call || call.calleeId !== me) return call ? forbidden() : invalidState()
				if (call.status !== 'ringing') return invalidState()
				plan = {
					call: { ...call, status: 'rejected', endedAt: now, endedBy: me },
					cleanupCallId: [call.id],
					res: Response.json({ ok: true, status: 'rejected' }),
				}
				break
			}

			case 'cancel': {
				if (!call || call.callerId !== me) return call ? forbidden() : invalidState()
				if (call.status !== 'ringing') return invalidState()
				plan = {
					call: { ...call, status: 'canceled', endedAt: now, endedBy: me },
					message: { kind: 'missedCall', senderId: me, text: '' },
					cleanupCallId: [call.id],
					res: Response.json({ ok: true, status: 'canceled' }),
				}
				break
			}

			case 'timeout': {
				// 発信者・受信側の、どちらの画面からでも依頼できる。経過時間は、ここで検証する
				if (!call) return invalidState()
				if (isTerminal(call)) return Response.json({ ok: true, status: call.status }) // 先に、誰かが確定している
				if (call.status !== 'ringing') return invalidState()
				const elapsed = nowMs - call.startedAt.getTime()
				if (elapsed < (LIMITS.ringSeconds - LIMITS.ringGraceSeconds) * 1000)
					return fail(409, 'too_early', 'まだ呼び出し中です')
				plan = {
					call: { ...call, status: 'missed', endedAt: now },
					message: { kind: 'missedCall', senderId: call.callerId, text: '' },
					cleanupCallId: [call.id],
					res: Response.json({ ok: true, status: 'missed' }),
				}
				break
			}

			case 'end': {
				if (!call) return invalidState()
				if (isTerminal(call)) return Response.json({ ok: true, status: call.status }) // 両方の画面が、ほぼ同時に終えることがある
				if (call.status !== 'connected') return invalidState()
				const talkedMs = nowMs - (call.answeredAt ?? call.startedAt).getTime()
				plan = {
					call: { ...call, status: 'ended', endedAt: now, endedBy: me, endReason: disconnected ? 'disconnected' : null },
					message: disconnected
						? { kind: 'callDisconnected', senderId: me, text: '' }
						: { kind: 'callEnded', senderId: me, text: durationText(talkedMs) },
					cleanupCallId: [call.id],
					res: Response.json({ ok: true, status: 'ended' }),
				}
				break
			}

			case 'ping': {
				if (!call) return invalidState()
				if (call.status !== 'connected') return Response.json({ ok: true, status: call.status })
				plan = {
					call: { ...call, lastPingAt: now },
					touchActivity: true,
					res: Response.json({ ok: true, status: 'connected' }),
				}
				break
			}
		}

		const update: FsData = { call: plan.call, updatedAt: now }
		if (plan.touchActivity) update.lastActivityAt = now
		const ops: Parameters<typeof fsBatch>[1] = []
		if (plan.message) {
			update.lastMessageAt = now
			update.lastMessageBy = plan.message.senderId
			ops.push({
				type: 'create',
				path: `teach_sessions/${sessionId}/messages/${crypto.randomUUID()}`,
				data: { type: 'system', senderId: plan.message.senderId, text: plan.message.text, kind: plan.message.kind, createdAt: now },
			})
		}
		ops.unshift({
			type: 'set',
			path: `teach_sessions/${sessionId}`,
			data: update,
			ifUpdateTime: doc.updateTime, // 同時に別の更新が入っていたら、失敗させる
		})

		try {
			await fsBatch(env, ops)
		} catch (e) {
			console.error('call commit failed', attempt, e)
			continue // 読み直して、やり直す
		}
		for (const id of plan.cleanupCallId ?? []) ctx.waitUntil(cleanupSignals(env, sessionId, id))
		return plan.res
	}
	return fail(409, 'invalid_state', '通話の状態を更新できませんでした。もう一度お試しください')
}

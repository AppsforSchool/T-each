import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LIMITS } from '../../shared/limits'
import { ApiError, apiFetch } from '../api'
import { Header } from '../components/Header'
import { db } from '../firebase'
import { hedged } from '../lib/hedged'
import { prepareImage } from '../lib/image'

type Tutor = { id: string; name: string; imageUrl?: string }
type Picked = { file: File; preview: string }

// 依頼の作成画面。URL: #/new?tutor=相手のID
export function NewRequest() {
	const [params] = useSearchParams()
	const tutorId = params.get('tutor') ?? ''
	const navigate = useNavigate()

	const [tutor, setTutor] = useState<Tutor | null | 'notfound'>(null)
	const [text, setText] = useState('')
	const [comment, setComment] = useState('')
	const [picked, setPicked] = useState<Picked[]>([])
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState('')
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!tutorId) return setTutor('notfound')
		hedged(() => getDoc(doc(db, 'users_random', tutorId)))
			.then((s) => {
				if (!s.exists()) return setTutor('notfound')
				const d = s.data()
				setTutor({
					id: s.id,
					name: typeof d.name === 'string' && d.name ? d.name : s.id,
					imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : undefined,
				})
			})
			.catch(() => setTutor('notfound'))
	}, [tutorId])

	// 選んだ画像の、プレビュー用URLを片付ける
	useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), [picked])

	const addFiles = (files: FileList | null) => {
		if (!files) return
		const room = LIMITS.maxImagesPerRequest - picked.length
		const next = Array.from(files)
			.filter((f) => (LIMITS.imageMimeTypes as readonly string[]).includes(f.type) || f.type.startsWith('image/'))
			.slice(0, Math.max(0, room))
			.map((file) => ({ file, preview: URL.createObjectURL(file) }))
		setPicked([...picked, ...next])
	}

	const removeAt = (i: number) => {
		URL.revokeObjectURL(picked[i].preview)
		setPicked(picked.filter((_, j) => j !== i))
	}

	const canSubmit = !busy && (text.trim() !== '' || picked.length > 0)

	const submit = async () => {
		setBusy(true)
		setError(null)
		try {
			const uploadIds: string[] = []
			for (let i = 0; i < picked.length; i++) {
				setStatus(`画像をアップロード中…（${i + 1}/${picked.length}）`)
				const prepared = await prepareImage(picked[i].file)
				const fd = new FormData()
				fd.append('file', prepared)
				const r = await apiFetch<{ uploadId: string }>('/api/images', { method: 'POST', body: fd })
				uploadIds.push(r.uploadId)
			}
			setStatus('依頼を送信中…')
			await apiFetch<{ sessionId: string }>('/api/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tutorId, text, comment, uploadIds }),
			})
			navigate('/')
		} catch (e) {
			setError(e instanceof ApiError || e instanceof Error ? e.message : '送信できませんでした')
			setBusy(false)
			setStatus('')
		}
	}

	return (
		<>
			<Header />
			<main className="page">
				{tutor === null && <p className="muted">読み込み中…</p>}
				{tutor === 'notfound' && (
					<div className="card">
						<p>相手が見つかりません。</p>
						<p style={{ marginTop: 8 }}>
							<Link to="/users">ユーザー一覧へ</Link>
						</p>
					</div>
				)}
				{tutor && tutor !== 'notfound' && (
					<div className="card form">
						<div className="profile-row">
							{tutor.imageUrl ? <img className="avatar" src={tutor.imageUrl} alt="" /> : <div className="avatar" />}
							<div>
								<p className="muted">依頼する相手</p>
								<b>{tutor.name}</b>
							</div>
						</div>

						<label>
							<span className="label">問題文（画像だけでも構いません）</span>
							<textarea
								className="input"
								rows={6}
								value={text}
								maxLength={LIMITS.sourceTextMaxChars}
								onChange={(e) => setText(e.target.value)}
								disabled={busy}
							/>
							<span className="muted">
								{text.length} / {LIMITS.sourceTextMaxChars}
							</span>
						</label>

						<div>
							<span className="label">画像（{LIMITS.maxImagesPerRequest}枚まで）</span>
							<div className="thumbs">
								{picked.map((p, i) => (
									<div className="thumb" key={p.preview}>
										<img src={p.preview} alt="" />
										<button className="thumb-remove" onClick={() => removeAt(i)} disabled={busy} aria-label="削除">
											×
										</button>
									</div>
								))}
								{picked.length < LIMITS.maxImagesPerRequest && (
									<label className="thumb thumb-add">
										＋
										<input
											type="file"
											accept="image/*"
											multiple
											hidden
											disabled={busy}
											onChange={(e) => {
												addFiles(e.target.files)
												e.target.value = ''
											}}
										/>
									</label>
								)}
							</div>
						</div>

						<label>
							<span className="label">コメント（任意）</span>
							<textarea
								className="input"
								rows={3}
								value={comment}
								maxLength={LIMITS.commentMaxChars}
								onChange={(e) => setComment(e.target.value)}
								disabled={busy}
								placeholder="どこが分からないか、など"
							/>
							<span className="muted">
								{comment.length} / {LIMITS.commentMaxChars}
							</span>
						</label>

						{error && <p className="error">{error}</p>}
						{status && <p className="muted">{status}</p>}
						<button className="btn" onClick={submit} disabled={!canSubmit}>
							{busy ? '送信中…' : '依頼する'}
						</button>
					</div>
				)}
			</main>
		</>
	)
}

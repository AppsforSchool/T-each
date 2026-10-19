// 既存サイトの firebase.js の hedged() と同じ考え方。
// 読み取りが hedgeMs 待っても返らないときに、同じ読み取りをもう1本出し直し、先に返ったほうを使う（最大 maxAttempts 本）。
// 使い方： await hedged(() => getDoc(doc(db, "a", "b")))
export function hedged<T>(
	fn: () => Promise<T>,
	{ hedgeMs = 4000, maxAttempts = 3 }: { hedgeMs?: number; maxAttempts?: number } = {}
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false
		let attempts = 0
		let failures = 0
		let timer: ReturnType<typeof setTimeout> | null = null

		const launch = () => {
			attempts++
			Promise.resolve()
				.then(fn)
				.then(
					(value) => {
						if (settled) return
						settled = true
						if (timer) clearTimeout(timer)
						resolve(value)
					},
					(error) => {
						failures++
						if (settled) return
						if (failures >= attempts) {
							if (timer) clearTimeout(timer)
							if (attempts >= maxAttempts) {
								settled = true
								reject(error)
							} else launch()
						}
					}
				)
			if (attempts < maxAttempts) {
				if (timer) clearTimeout(timer)
				timer = setTimeout(() => {
					if (!settled) launch()
				}, hedgeMs)
			}
		}
		launch()
	})
}

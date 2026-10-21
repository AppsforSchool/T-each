import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { hedged } from './hedged'

export type UserInfo = { id: string; name: string; imageUrl?: string }

const cache = new Map<string, Promise<UserInfo>>()

/** users_random から、名前とアイコンを読む（同じIDは、1回だけ読む）。読めなければ、IDを名前として使う。 */
export function loadUser(id: string): Promise<UserInfo> {
	let p = cache.get(id)
	if (!p) {
		p = hedged(() => getDoc(doc(db, 'users_random', id)))
			.then((s) => {
				const d = s.data()
				return {
					id,
					name: typeof d?.name === 'string' && d.name ? d.name : id,
					imageUrl: typeof d?.imageUrl === 'string' ? d.imageUrl : undefined,
				}
			})
			.catch(() => ({ id, name: id }))
		cache.set(id, p)
	}
	return p
}

export function useUser(id: string | null | undefined): UserInfo | null {
	const [user, setUser] = useState<UserInfo | null>(null)
	useEffect(() => {
		let alive = true
		setUser(null)
		if (id) loadUser(id).then((u) => alive && setUser(u))
		return () => {
			alive = false
		}
	}, [id])
	return user
}

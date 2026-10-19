import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { LOGIN_DOMAIN } from './config'
import { auth } from './firebase'

type AuthState = {
	user: User | null
	/** users_random のドキュメントIDと同じ（メールアドレスの @ より前） */
	userId: string | null
	loading: boolean
	login(id: string, password: string): Promise<void>
	logout(): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function userIdFromEmail(email: string | null | undefined): string | null {
	if (!email) return null
	const [local, domain] = email.split('@')
	return domain === LOGIN_DOMAIN ? local : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(
		() =>
			onAuthStateChanged(auth, (u) => {
				setUser(u)
				setLoading(false)
			}),
		[]
	)

	const value: AuthState = {
		user,
		userId: userIdFromEmail(user?.email),
		loading,
		login: async (id, password) => {
			await signInWithEmailAndPassword(auth, `${id.trim()}@${LOGIN_DOMAIN}`, password)
		},
		logout: () => signOut(auth),
	}
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
	const v = useContext(Ctx)
	if (!v) throw new Error('AuthProvider is missing')
	return v
}

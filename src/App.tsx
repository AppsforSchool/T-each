import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { CallOverlay } from './components/CallOverlay'
import { PresenceReporter } from './components/Presence'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { NewRequest } from './pages/NewRequest'
import { SessionPage } from './pages/SessionPage'
import { Users } from './pages/Users'

function RequireAuth({ children }: { children: ReactNode }) {
	const { user } = useAuth()
	return user ? <>{children}</> : <Navigate to="/login" replace />
}

export function App() {
	const { user, loading } = useAuth()
	if (loading) return <p style={{ padding: 16 }}>読み込み中…</p>
	return (
		<>
		{user && <CallOverlay />}
		{user && <PresenceReporter />}
		<Routes>
			<Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
			<Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
			<Route path="/new" element={<RequireAuth><NewRequest /></RequireAuth>} />
			<Route path="/s/:id" element={<RequireAuth><SessionPage /></RequireAuth>} />
			<Route path="/users" element={<RequireAuth><Users /></RequireAuth>} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
		</>
	)
}

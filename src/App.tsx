import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { Home } from './pages/Home'
import { Login } from './pages/Login'

export function App() {
	const { user, loading } = useAuth()
	if (loading) return <p style={{ padding: 16 }}>読み込み中…</p>
	return (
		<Routes>
			<Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
			<Route path="/" element={user ? <Home /> : <Navigate to="/login" replace />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	)
}

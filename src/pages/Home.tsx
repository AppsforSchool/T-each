import { Header } from '../components/Header'
import { SessionList } from '../components/SessionList'

// ホーム：自分が関わる依頼・セッションの一覧（状態別）
export function Home() {
	return (
		<>
			<Header />
			<main className="page">
				<SessionList />
			</main>
		</>
	)
}

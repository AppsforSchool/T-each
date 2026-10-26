import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './styles.css'
import { AuthProvider } from './auth'
import { CallProvider } from './lib/CallContext'

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<HashRouter>
			<AuthProvider>
				<CallProvider>
					<App />
				</CallProvider>
			</AuthProvider>
		</HashRouter>
	</StrictMode>
)

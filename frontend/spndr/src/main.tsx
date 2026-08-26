import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { bootstrapLocalDb } from './db/bootstrapLocalDb'

const rootElement = document.getElementById('root')

if (rootElement) {
    void bootstrapLocalDb().finally(() => {
        createRoot(rootElement).render(
            <StrictMode>
                <App />
            </StrictMode>
        )
    })
} else {
    console.error('Root element not found')
}

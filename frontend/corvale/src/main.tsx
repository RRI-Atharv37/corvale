import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { bootstrapLocalDb } from './db/bootstrapLocalDb'
import { attachDesktopConsoleLogging } from './desktop/desktopLog'

const rootElement = document.getElementById('root')

if (rootElement) {
    // Attach console forwarding first so `bootstrapLocalDb`'s own diagnostics land in the log file.
    void attachDesktopConsoleLogging()
        .then(() => bootstrapLocalDb())
        .finally(() => {
            createRoot(rootElement).render(
                <StrictMode>
                    <App />
                </StrictMode>
            )
        })
} else {
    console.error('Root element not found')
}

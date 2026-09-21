import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * The admin app has its own strict CSP, and it names the one API origin it may call. Nothing else is allowed:
 * no third-party scripts, no framing, no inline script. Resolved at build time from VITE_ADMIN_API_URL.
 */
const cspPlugin = (apiOrigin: string): Plugin => ({
  name: 'admin-csp',
  transformIndexHtml: (html) => html.replace('%ADMIN_API_ORIGIN%', apiOrigin),
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')
  const apiUrl = env.VITE_ADMIN_API_URL ?? 'http://localhost:5000/api/v1/admin'
  const apiOrigin = new URL(apiUrl).origin

  return {
    plugins: [react(), tailwindcss(), cspPlugin(apiOrigin)],
    server: { port: 5180, strictPort: true },
    preview: { port: 5180, strictPort: true },
    build: { outDir: path.resolve(root, '../../dist/admin'), emptyOutDir: true, sourcemap: false },
    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})

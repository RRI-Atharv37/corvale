/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string
    readonly VITE_API_ORIGIN?: string
    readonly VITE_LOCAL_FIRST?: string
    readonly VITE_LOCAL_PIN?: string
    readonly VITE_DOCS_URL?: string
    readonly VITE_OFFLINE_GRANT_PUBLIC_KEY?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

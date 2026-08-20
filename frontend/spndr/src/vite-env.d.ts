/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string
    readonly VITE_LOCAL_FIRST?: string
    readonly VITE_DOCS_URL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

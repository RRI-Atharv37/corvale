import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * RF1: the `@shared/*` alias (and the reserved `@core`/`@infra`/`@http`/`@modules` slots the
 * relocation fills in RF2/RF3) must resolve here exactly as they do in `tsconfig.json`. `tsc`
 * paths don't reach Vitest, so they are restated as `resolve.alias`.
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            '@shared': r('../shared/src'),
            '@core': r('./src/core'),
            '@infra': r('./src/infra'),
            '@http': r('./src/http'),
            '@modules': r('./src/modules'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.mts'],
        pool: 'forks',
        fileParallelism: false,
        testTimeout: 30000,
        hookTimeout: 30000,
    },
})

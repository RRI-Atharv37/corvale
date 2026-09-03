import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * RF1: the `@shared/*` alias (and the `@core`/`@infra`/`@http`/`@modules` slots the relocation
 * fills in RF2/RF3) must resolve here exactly as they do in `tsconfig.json`. `tsc` paths don't
 * reach Vitest, so they are restated as `resolve.alias`. RF4 adds `@tests/*` for the co-located
 * suites that still reach the shared harness under `tests/`.
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
            '@tests': r('./tests'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        // RF4: suites co-locate in `src/**/__tests__/`; cross-module + repo-config suites and the
        // harness stay under `tests/`. Listed explicitly so a stray `*.test.ts` elsewhere (e.g. in
        // `scripts/`) is never collected.
        include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
        setupFiles: ['./tests/setup.mts'],
        pool: 'forks',
        fileParallelism: false,
        testTimeout: 30000,
        hookTimeout: 30000,
    },
})

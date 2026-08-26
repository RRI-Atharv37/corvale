import { defineConfig } from 'vitest/config'

export default defineConfig({
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

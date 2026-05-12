import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            obsidian: path.resolve('./tests/mocks/obsidian.ts'),
        },
    },
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
        },
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        setupFiles: ['./tests/setup-globals.ts'],
    },
});

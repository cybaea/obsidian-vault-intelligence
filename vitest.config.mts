import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            obsidian: path.resolve('./tests/mocks/obsidian.ts'),
            '@huggingface/transformers/src': path.resolve('./node_modules/@huggingface/transformers/src'),
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

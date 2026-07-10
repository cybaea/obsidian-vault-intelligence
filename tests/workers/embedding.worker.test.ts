import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GlobalWorkerTestScope = {
    activeWindow?: Window;
    self?: unknown;
    addEventListener?: typeof globalThis.addEventListener;
};

// vi.mock calls are hoisted above imports, so we use vi.hoisted to create a
// shared env object that both the main package mock and the deep-path env.js
// mock can reference. The worker imports env from
// @huggingface/transformers/src/env.js, so both paths must return the same
// instance for the test to verify that env.fetch was assigned.
const sharedEnv = vi.hoisted<Record<string, unknown>>(() => ({}));

vi.mock('@huggingface/transformers', () => {
    const mockDispose = vi.fn();
    const mockPipeline = vi.fn().mockImplementation(() => {
        return Object.assign(
            vi.fn().mockResolvedValue({
                data: new Float32Array([0.1, 0.2, 0.3])
            }),
            {
                dispose: mockDispose,
                tokenizer: vi.fn().mockResolvedValue({
                    input_ids: [1, 2, 3]
                })
            }
        );
    });

    return {
        AutoModel: {
            from_pretrained: vi.fn().mockResolvedValue({
                dispose: mockDispose
            })
        },
        AutoTokenizer: {
            from_pretrained: vi.fn().mockResolvedValue({
                decode: vi.fn().mockReturnValue('mock text')
            })
        },
        env: sharedEnv,
        pipeline: mockPipeline,
        PipelineType: {},
        PreTrainedModel: class {},
        Tensor: class {
            data: unknown;
            constructor(type: string, data: unknown, dims?: unknown) {
                this.data = data;
            }
        },
    };
});

vi.mock('@huggingface/transformers/src/env.js', () => ({
    env: sharedEnv
}));

vi.mock('@huggingface/transformers/src/pipelines/feature-extraction.js', () => {
    const mockDispose = vi.fn();
    const MockFeatureExtractionPipeline = vi.fn().mockImplementation(() => {
        return Object.assign(
            vi.fn().mockResolvedValue({
                data: new Float32Array([0.1, 0.2, 0.3])
            }),
            {
                dispose: mockDispose,
                tokenizer: vi.fn().mockResolvedValue({
                    input_ids: [1, 2, 3]
                })
            }
        );
    });

    return {
        FeatureExtractionPipeline: MockFeatureExtractionPipeline
    };
});

const globalRef = globalThis as unknown as GlobalWorkerTestScope;
const originalActiveWindow = globalRef.activeWindow;
const originalSelf = globalRef.self;
const originalAddEventListener = globalRef.addEventListener;
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

describe('Embedding worker timer fallback', () => {
    beforeEach(() => {
        vi.resetModules();

        delete globalRef.activeWindow;
        globalRef.self = globalThis;
        globalRef.addEventListener = vi.fn();

        const mockedSetTimeout = vi.fn((callback: TimerHandler, ms?: number, ...args: unknown[]) => {
            return originalSetTimeout(callback, ms, ...args);
        }) as unknown as typeof setTimeout;
        const mockedClearTimeout = vi.fn((timeout?: number | ReturnType<typeof originalSetTimeout>) => {
            return originalClearTimeout(timeout as number | undefined);
        }) as unknown as typeof clearTimeout;

        globalThis.setTimeout = mockedSetTimeout;
        globalThis.clearTimeout = mockedClearTimeout;

        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    });

    afterEach(() => {
        globalRef.activeWindow = originalActiveWindow;
        globalRef.self = originalSelf;
        globalRef.addEventListener = originalAddEventListener;
        globalThis.fetch = originalFetch;
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    });

    it('falls back to globalThis timers when activeWindow is unavailable', async () => {
        const workerModule = await import('../../src/workers/embedding.worker');

        expect(workerModule.timer.setTimeout).toBe(globalThis.setTimeout);
        expect(workerModule.timer.clearTimeout).toBe(globalThis.clearTimeout);
    });
});

describe('Embedding worker env.fetch proxy assignment', () => {
    beforeEach(() => {
        vi.resetModules();

        globalRef.self = globalThis;
        globalRef.addEventListener = vi.fn();
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    });

    afterEach(() => {
        globalRef.self = originalSelf;
        globalRef.addEventListener = originalAddEventListener;
        globalThis.fetch = originalFetch;
    });

    it('assigns the proxy function to env.fetch so Transformers.js uses the CORS-bypassing proxy', async () => {
        // The mock for @huggingface/transformers provides `env: {}`.
        // After the worker module loads, it should set env.fetch to our proxy.
        const transformersModule = await import('@huggingface/transformers');
        await import('../../src/workers/embedding.worker');

        const env = (transformersModule as unknown as { env: Record<string, unknown> }).env;
        expect(env.fetch).toBeDefined();
        expect(typeof env.fetch).toBe('function');
        // env.fetch should be the proxiedFetch function, not the original native fetch
        expect(env.fetch).not.toBe(originalFetch);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GlobalWorkerTestScope = {
    activeWindow?: Window;
    self?: unknown;
    addEventListener?: typeof globalThis.addEventListener;
};

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
        env: {},
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

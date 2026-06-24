/**
 * Polyfill global window for background Web Worker scopes to satisfy
 * third-party libraries (such as onnxruntime-web) that reference it directly.
 */

interface SafeGlobal {
    process?: {
        env?: Record<string, string>;
        versions?: {
            node?: string;
        };
    };
    window?: typeof globalThis;
}

const safeGlobal = globalThis as unknown as SafeGlobal;

// 1. Polyfill window for worker threads
if (typeof safeGlobal.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        enumerable: false,
        value: globalThis,
        writable: true
    });
}

// 2. Prevent onnxruntime-web from thinking we are running in a Node.js environment
// inside Electron's Web Workers, which throws due to missing worker_threads.
// We only do this if we are not running in the Vitest testing environment.
const isVitest = typeof safeGlobal.process !== 'undefined' &&
    safeGlobal.process.env &&
    (safeGlobal.process.env.VITEST === 'true' || !!safeGlobal.process.env.VITEST);

if (!isVitest && typeof safeGlobal.process !== 'undefined') {
    try {
        // Try to nullify process completely for the worker
        Object.defineProperty(globalThis, 'process', {
            configurable: true,
            enumerable: false,
            value: undefined,
            writable: true
        });
    } catch {
        // If process is non-configurable, safely clear process.versions.node
        const proc = safeGlobal.process;
        if (proc && proc.versions) {
            try {
                Object.defineProperty(proc.versions, 'node', {
                    configurable: true,
                    enumerable: true,
                    value: undefined,
                    writable: true
                });
            } catch {
                // Ignore if read-only
            }
        }
    }
}

export {};

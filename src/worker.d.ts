// Type definitions for inline workers (esbuild-plugin-inline-worker)
declare module "*.worker" {
    class InlineWorker extends Worker {
        constructor(options?: WorkerOptions);
    }
    export default InlineWorker;
}

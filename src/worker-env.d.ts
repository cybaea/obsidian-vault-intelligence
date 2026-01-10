declare module "*.worker" {
    class InlineWorker extends Worker {
        constructor(options?: WorkerOptions);
    }
    export default InlineWorker;
}

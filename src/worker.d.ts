// Match imports ending in ".worker" (extensionless)
declare module "*.worker" {
    class WebpackWorker extends Worker {
        constructor();
    }
    export default WebpackWorker;
}

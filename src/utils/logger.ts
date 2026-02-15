export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export class Logger {
    private static instance: Logger;
    private level: LogLevel = LogLevel.WARN;
    private silent: boolean = false;

    private constructor() { }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public setLevel(level: LogLevel) {
        this.level = level;
    }

    public setSilent(silent: boolean) {
        this.silent = silent;
    }

    public debug(message: string, ...args: unknown[]) {
        if (!this.silent && this.level <= LogLevel.DEBUG) {
            console.debug(`[VaultIntelligence:DEBUG] ${message}`, ...args);
        }
    }

    public info(message: string, ...args: unknown[]) {
        if (!this.silent && this.level <= LogLevel.INFO) {
            console.warn(`[VaultIntelligence:INFO] ${message}`, ...args);
        }
    }

    public warn(message: string, ...args: unknown[]) {
        if (!this.silent && this.level <= LogLevel.WARN) {
            console.warn(`[VaultIntelligence:WARN] ${message}`, ...args);
        }
    }

    public error(message: string, ...args: unknown[]) {
        if (!this.silent && this.level <= LogLevel.ERROR) {
            console.error(`[VaultIntelligence:ERROR] ${message}`, ...args);
        }
    }
}
export const logger = Logger.getInstance();

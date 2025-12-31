/* eslint-disable no-console -- This is a logger utility whose purpose is to provide a controlled interface to console methods (warn, error, debug). Direct console usage is required for the implementation. */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export class Logger {
    private static instance: Logger;
    private level: LogLevel = LogLevel.WARN;

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

    public debug(message: string, ...args: unknown[]) {
        if (this.level <= LogLevel.DEBUG) {
            console.debug(`[VaultIntelligence:DEBUG] ${message}`, ...args);
        }
    }

    public info(message: string, ...args: unknown[]) {
        if (this.level <= LogLevel.INFO) {
            console.info(`[VaultIntelligence:INFO] ${message}`, ...args);
        }
    }

    public warn(message: string, ...args: unknown[]) {
        if (this.level <= LogLevel.WARN) {
            console.warn(`[VaultIntelligence:WARN] ${message}`, ...args);
        }
    }

    public error(message: string, ...args: unknown[]) {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[VaultIntelligence:ERROR] ${message}`, ...args);
        }
    }
}
/* eslint-enable no-console -- re-enable after logger class */

export const logger = Logger.getInstance();

/**
 * jurisd - Structured logging utility
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Provides levelled logging with environment-variable configuration.
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
export class Logger {
    level;
    constructor(level = LogLevel.INFO) {
        this.level = level;
    }
    /**
     * Log a debug-level message (most verbose).
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    debug(message, meta) {
        if (this.level <= LogLevel.DEBUG) {
            console.error(`[DEBUG] ${message}`, meta ?? "");
        }
    }
    /**
     * Log an informational message.
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    info(message, meta) {
        if (this.level <= LogLevel.INFO) {
            console.error(`[INFO] ${message}`, meta ?? "");
        }
    }
    /**
     * Log a warning message.
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    warn(message, meta) {
        if (this.level <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, meta ?? "");
        }
    }
    /**
     * Log an error message.
     *
     * @param message - Human-readable log message
     * @param error - The Error or unknown value that triggered this log
     * @param meta - Optional structured metadata
     */
    error(message, error, meta) {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, { error, ...meta });
        }
    }
}
/**
 * Parse the LOG_LEVEL environment variable into a {@link LogLevel}.
 * Falls back to `INFO` if unset or invalid.
 */
export function parseLogLevel() {
    const raw = process.env.LOG_LEVEL;
    if (raw === undefined)
        return LogLevel.INFO;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < LogLevel.DEBUG || parsed > LogLevel.ERROR) {
        return LogLevel.INFO;
    }
    return parsed;
}
/** Singleton logger instance configured via LOG_LEVEL env var */
export const logger = new Logger(parseLogLevel());
//# sourceMappingURL=logger.js.map
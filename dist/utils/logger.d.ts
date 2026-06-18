/**
 * jurisd - Structured logging utility
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Provides levelled logging with environment-variable configuration.
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export declare class Logger {
    private level;
    constructor(level?: LogLevel);
    /**
     * Log a debug-level message (most verbose).
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    debug(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log an informational message.
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    info(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log a warning message.
     *
     * @param message - Human-readable log message
     * @param meta - Optional structured metadata
     */
    warn(message: string, meta?: Record<string, unknown>): void;
    /**
     * Log an error message.
     *
     * @param message - Human-readable log message
     * @param error - The Error or unknown value that triggered this log
     * @param meta - Optional structured metadata
     */
    error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void;
}
/**
 * Parse the LOG_LEVEL environment variable into a {@link LogLevel}.
 * Falls back to `INFO` if unset or invalid.
 */
export declare function parseLogLevel(): LogLevel;
/** Singleton logger instance configured via LOG_LEVEL env var */
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map
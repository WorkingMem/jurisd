import { describe, it, expect, vi, afterEach } from "vitest";
import { LogLevel, Logger, logger, parseLogLevel } from "../../utils/logger.js";

describe("LogLevel enum", () => {
  it("should define correct level values", () => {
    expect(LogLevel.DEBUG).toBe(0);
    expect(LogLevel.INFO).toBe(1);
    expect(LogLevel.WARN).toBe(2);
    expect(LogLevel.ERROR).toBe(3);
  });
});

describe("logger singleton", () => {
  it("should be defined", () => {
    expect(logger).toBeDefined();
  });

  it("should have all log methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("should not throw when called", () => {
    expect(() => logger.debug("test debug")).not.toThrow();
    expect(() => logger.info("test info")).not.toThrow();
    expect(() => logger.warn("test warn")).not.toThrow();
    expect(() => logger.error("test error")).not.toThrow();
    expect(() => logger.error("test error", new Error("cause"))).not.toThrow();
    expect(() => logger.info("test meta", { key: "value" })).not.toThrow();
  });
});

describe("parseLogLevel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns INFO when LOG_LEVEL is not set", () => {
    vi.stubEnv("LOG_LEVEL", "");
    // unstub to truly unset
    vi.unstubAllEnvs();
    expect(parseLogLevel()).toBe(LogLevel.INFO);
  });

  it("returns INFO when LOG_LEVEL is a non-numeric string", () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    expect(parseLogLevel()).toBe(LogLevel.INFO);
  });

  it("returns INFO when LOG_LEVEL is out of range (too high)", () => {
    vi.stubEnv("LOG_LEVEL", "99");
    expect(parseLogLevel()).toBe(LogLevel.INFO);
  });

  it("returns INFO when LOG_LEVEL is negative", () => {
    vi.stubEnv("LOG_LEVEL", "-1");
    expect(parseLogLevel()).toBe(LogLevel.INFO);
  });

  it("returns DEBUG when LOG_LEVEL is 0", () => {
    vi.stubEnv("LOG_LEVEL", "0");
    expect(parseLogLevel()).toBe(LogLevel.DEBUG);
  });

  it("returns WARN when LOG_LEVEL is 2", () => {
    vi.stubEnv("LOG_LEVEL", "2");
    expect(parseLogLevel()).toBe(LogLevel.WARN);
  });

  it("returns ERROR when LOG_LEVEL is 3", () => {
    vi.stubEnv("LOG_LEVEL", "3");
    expect(parseLogLevel()).toBe(LogLevel.ERROR);
  });
});

describe("Logger level filtering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses debug when level is INFO", () => {
    const testLogger = new Logger(LogLevel.INFO);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.debug("debug message");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits debug when level is DEBUG", () => {
    const testLogger = new Logger(LogLevel.DEBUG);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.debug("debug message");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG]"), expect.anything());
  });

  it("emits info when level is INFO", () => {
    const testLogger = new Logger(LogLevel.INFO);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.info("info message");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[INFO]"), expect.anything());
  });

  it("suppresses info and debug when level is WARN", () => {
    const testLogger = new Logger(LogLevel.WARN);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.info("info message");
    testLogger.debug("debug message");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits warn when level is WARN", () => {
    const testLogger = new Logger(LogLevel.WARN);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    testLogger.warn("warn message");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[WARN]"), expect.anything());
  });

  it("suppresses all non-error levels when level is ERROR", () => {
    const testLogger = new Logger(LogLevel.ERROR);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    testLogger.info("info");
    testLogger.debug("debug");
    testLogger.warn("warn");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits error when level is ERROR", () => {
    const testLogger = new Logger(LogLevel.ERROR);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.error("error message", new Error("cause"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[ERROR]"), expect.anything());
  });

  it("passes metadata to info output", () => {
    const testLogger = new Logger(LogLevel.INFO);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const meta = { key: "value" };
    testLogger.info("with meta", meta);
    expect(spy).toHaveBeenCalledWith("[INFO] with meta", meta);
  });

  it("passes empty string when metadata is absent", () => {
    const testLogger = new Logger(LogLevel.INFO);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.info("no meta");
    expect(spy).toHaveBeenCalledWith("[INFO] no meta", "");
  });

  it("suppresses error output when level is above ERROR (line 67 false branch)", () => {
    // Force a level above ERROR (3) to test the false branch of if(this.level <= LogLevel.ERROR)
    const testLogger = new Logger(99 as LogLevel);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    testLogger.error("should not emit");
    expect(spy).not.toHaveBeenCalled();
  });
});

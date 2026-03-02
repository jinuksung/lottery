import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Writable } from "node:stream";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface LoggerOptions {
  logFilePath: string;
  stdout?: Writable;
  stderr?: Writable;
  now?: () => Date;
}

const stringifyMeta = (meta?: Record<string, unknown>): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(meta)}`;
};

export const createLogger = (options: LoggerOptions): Logger => {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const now = options.now ?? (() => new Date());

  mkdirSync(dirname(options.logFilePath), { recursive: true });

  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    const line = `${now().toISOString()} [${level}] ${message}${stringifyMeta(meta)}\n`;
    appendFileSync(options.logFilePath, line, "utf8");

    if (level === "ERROR") {
      stderr.write(line);
      return;
    }

    stdout.write(line);
  };

  return {
    info: (message, meta) => write("INFO", message, meta),
    warn: (message, meta) => write("WARN", message, meta),
    error: (message, meta) => write("ERROR", message, meta)
  };
};

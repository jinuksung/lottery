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

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  blue: "\u001b[34m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m"
} as const;

const colorizeLevel = (level: LogLevel): string => {
  switch (level) {
    case "INFO":
      return `${ANSI.blue}[${level}]${ANSI.reset}`;
    case "WARN":
      return `${ANSI.yellow}[${level}]${ANSI.reset}`;
    case "ERROR":
      return `${ANSI.red}[${level}]${ANSI.reset}`;
  }
};

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
    const timestamp = now().toISOString();
    const metaText = stringifyMeta(meta);
    const line = `${timestamp} [${level}] ${message}${metaText}\n`;
    const consoleLine =
      `${ANSI.dim}${timestamp}${ANSI.reset} ${colorizeLevel(level)} ${message}` +
      `${metaText ? ` ${ANSI.gray}${metaText.trimStart()}${ANSI.reset}` : ""}\n`;

    appendFileSync(options.logFilePath, line, "utf8");

    if (level === "ERROR") {
      stderr.write(consoleLine);
      return;
    }

    stdout.write(consoleLine);
  };

  return {
    info: (message, meta) => write("INFO", message, meta),
    warn: (message, meta) => write("WARN", message, meta),
    error: (message, meta) => write("ERROR", message, meta)
  };
};

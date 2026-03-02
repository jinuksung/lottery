export enum AppErrorCode {
  ERR01_INSUFFICIENT_DEPOSIT = "Err01",
  ERR02_INVALID_CREDENTIALS = "Err02",
  ERR03_ADDITIONAL_AUTH_REQUIRED = "Err03",
  ERR04_LOGIN_TIMEOUT = "Err04",
  ERR05_NAVIGATION_FAILURE = "Err05",
  ERR06_PURCHASE_FAILURE = "Err06",
  ERR07_PURCHASE_HISTORY_NOT_FOUND = "Err07",
  ERR08_UNEXPECTED = "Err08"
}

const EXIT_CODE_MAP: Record<AppErrorCode, number> = {
  [AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT]: 11,
  [AppErrorCode.ERR02_INVALID_CREDENTIALS]: 12,
  [AppErrorCode.ERR03_ADDITIONAL_AUTH_REQUIRED]: 13,
  [AppErrorCode.ERR04_LOGIN_TIMEOUT]: 14,
  [AppErrorCode.ERR05_NAVIGATION_FAILURE]: 15,
  [AppErrorCode.ERR06_PURCHASE_FAILURE]: 16,
  [AppErrorCode.ERR07_PURCHASE_HISTORY_NOT_FOUND]: 17,
  [AppErrorCode.ERR08_UNEXPECTED]: 18
};

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export const exitCodeForError = (error: unknown): number => {
  if (!isAppError(error)) {
    return 1;
  }

  return EXIT_CODE_MAP[error.code] ?? 1;
};

export const formatErrorForMessage = (error: unknown): string => {
  if (isAppError(error)) {
    return `[${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return `[Unknown] ${error.message}`;
  }

  return `[Unknown] ${String(error)}`;
};

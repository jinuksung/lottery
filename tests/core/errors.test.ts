import { describe, expect, test } from "vitest";
import { AppError, AppErrorCode, exitCodeForError, formatErrorForMessage } from "../../src/core/errors";

describe("core/errors", () => {
  test("maps Err01 to dedicated exit code", () => {
    const err = new AppError(AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT, "예치금 부족");

    expect(exitCodeForError(err)).toBe(11);
  });

  test("maps unknown error to generic non-zero exit code", () => {
    expect(exitCodeForError(new Error("boom"))).toBe(1);
  });

  test("formats domain error message with code", () => {
    const err = new AppError(AppErrorCode.ERR02_INVALID_CREDENTIALS, "비밀번호 불일치", {
      stage: "login"
    });

    expect(formatErrorForMessage(err)).toContain("[Err02]");
    expect(formatErrorForMessage(err)).toContain("비밀번호 불일치");
  });
});

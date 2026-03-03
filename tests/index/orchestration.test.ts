import { describe, expect, test, vi } from "vitest";
import type { AppConfig } from "../../src/core/config";
import { AppError, AppErrorCode } from "../../src/core/errors";
import { runApp } from "../../src/app";

const sampleConfig: AppConfig = {
  credentials: {
    id: "id",
    password: "pw"
  },
  telegram: {
    botToken: "token",
    chatId: "chat"
  },
  purchase: {
    gameCount: 2,
    pricePerGame: 1000
  },
  browser: {
    headless: true
  },
  dhlottery: {
    baseUrl: "https://www.dhlottery.co.kr"
  }
};

describe("app orchestration", () => {
  test("returns 0 on success and sends progress messages", async () => {
    const sentMessages: string[] = [];
    let forwardedCwd = "";

    const exitCode = await runApp({
      cwd: "/tmp",
      loadConfig: () => sampleConfig,
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }),
      createTelegramClient: () => ({
        send: async (message: string) => {
          sentMessages.push(message);
        }
      }),
      runLotteryPurchaseOnce: async ({ notifyStep, cwd }) => {
        forwardedCwd = cwd;
        await notifyStep(1, 5, "사이트 접속을 완료했습니다.");
        await notifyStep(2, 5, "로그인을 완료했습니다.");
        return {
          purchasedAt: "2026-02-27T00:00:00.000Z",
          drawNo: 1171,
          gameCount: 2,
          numbers: [
            [1, 2, 3, 4, 5, 6],
            [11, 12, 13, 14, 15, 16]
          ],
          availableDeposit: 5000,
          requiredDeposit: 2000
        };
      },
      appendPurchaseHistory: async () => undefined
    });

    expect(exitCode).toBe(0);
    expect(forwardedCwd).toBe("/tmp");
    expect(sentMessages[0]).toContain("(1/5)");
    expect(sentMessages[1]).toContain("(2/5)");
    expect(sentMessages.at(-1)).toContain("구매 완료");
  });

  test("returns mapped exit code and sends error message on AppError", async () => {
    const sentMessages: string[] = [];
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const exitCode = await runApp({
      cwd: "/tmp",
      loadConfig: () => sampleConfig,
      createLogger: () => logger,
      createTelegramClient: () => ({
        send: async (message: string) => {
          sentMessages.push(message);
        }
      }),
      runLotteryPurchaseOnce: async () => {
        throw new AppError(AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT, "예치금 부족", {
          availableDeposit: 0,
          requiredDeposit: 1000
        });
      },
      appendPurchaseHistory: async () => undefined
    });

    expect(exitCode).toBe(11);
    expect(sentMessages.at(-1)).toContain("Err01");
    expect(logger.error).toHaveBeenCalledWith("run-once 구매 프로세스 실패", {
      code: AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT,
      details: {
        availableDeposit: 0,
        requiredDeposit: 1000
      },
      message: "[Err01] 예치금 부족"
    });
  });
});

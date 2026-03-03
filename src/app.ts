import { resolve } from "node:path";
import type { AppConfig } from "./core/config";
import { loadConfig } from "./core/config";
import {
  AppError,
  AppErrorCode,
  exitCodeForError,
  formatErrorForMessage,
  isAppError
} from "./core/errors";
import { createLogger, type Logger } from "./core/logger";
import { runLotteryPurchaseOnce, type RunOnceResult } from "./lottery/client";
import {
  createTelegramClient,
  formatErrorMessage,
  formatProgressMessage,
  type TelegramClient
} from "./services/telegram";
import { appendPurchaseHistory } from "./services/purchaseHistory";

interface AppDependencies {
  cwd?: string;
  loadConfig?: () => AppConfig;
  createLogger?: (options: { logFilePath: string }) => Logger;
  createTelegramClient?: (options: { botToken: string; chatId: string }) => TelegramClient;
  runLotteryPurchaseOnce?: typeof runLotteryPurchaseOnce;
  appendPurchaseHistory?: typeof appendPurchaseHistory;
}

const buildCompletionMessage = (result: RunOnceResult): string => {
  const numbersText = result.numbers.map((nums, idx) => `${idx + 1}게임: ${nums.join(",")}`).join("\n");
  return [
    "로또 구매 완료",
    `회차: ${result.drawNo}회`,
    `구매 게임 수: ${result.gameCount}`,
    `필요 금액: ${result.requiredDeposit}원`,
    `예치금: ${result.availableDeposit}원`,
    "구매 번호:",
    numbersText
  ].join("\n");
};

export const runApp = async (deps: AppDependencies = {}): Promise<number> => {
  const cwd = deps.cwd ?? process.cwd();
  const logFilePath = resolve(cwd, "logs/run-once.log");
  const historyPath = resolve(cwd, "data/purchase-history.jsonl");

  const loadConfigFn = deps.loadConfig ?? (() => loadConfig(process.env));
  const createLoggerFn = deps.createLogger ?? ((options: { logFilePath: string }) => createLogger(options));
  const createTelegramClientFn =
    deps.createTelegramClient ??
    ((options: { botToken: string; chatId: string }) => createTelegramClient(options));
  const runLotteryPurchaseOnceFn = deps.runLotteryPurchaseOnce ?? runLotteryPurchaseOnce;
  const appendPurchaseHistoryFn = deps.appendPurchaseHistory ?? appendPurchaseHistory;

  const logger = createLoggerFn({ logFilePath });
  let telegram: TelegramClient | undefined;

  try {
    const config = loadConfigFn();
    const telegramClient = createTelegramClientFn({
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId
    });
    telegram = telegramClient;

    const notifyStep = async (step: number, total: number, description: string): Promise<void> => {
      const message = formatProgressMessage(step, total, description);
      logger.info("진행 단계 알림", { step, total, description });

      try {
        await telegramClient.send(message);
      } catch (error) {
        throw new AppError(AppErrorCode.ERR08_UNEXPECTED, "텔레그램 진행 알림 발송에 실패했습니다.", {
          originalError: error instanceof Error ? error.message : String(error)
        });
      }
    };

    const result = await runLotteryPurchaseOnceFn({
      cwd,
      config,
      logger,
      notifyStep
    });

    await appendPurchaseHistoryFn(historyPath, {
      purchasedAt: result.purchasedAt,
      drawNo: result.drawNo,
      gameCount: result.gameCount,
      numbers: result.numbers
    });

    await telegram.send(buildCompletionMessage(result));
    logger.info("run-once 구매 프로세스 완료", {
      drawNo: result.drawNo,
      gameCount: result.gameCount,
      historyPath
    });

    return 0;
  } catch (error) {
    const appErrorCode = isAppError(error) ? error.code : AppErrorCode.ERR08_UNEXPECTED;
    const formatted = formatErrorForMessage(error);

    logger.error("run-once 구매 프로세스 실패", {
      code: appErrorCode,
      details: isAppError(error) ? error.details : undefined,
      message: formatted
    });

    if (telegram) {
      await telegram.send(formatErrorMessage(appErrorCode, formatted)).catch((telegramError) => {
        logger.error("오류 텔레그램 발송 실패", {
          message: telegramError instanceof Error ? telegramError.message : String(telegramError)
        });
      });
    }

    return exitCodeForError(error);
  }
};

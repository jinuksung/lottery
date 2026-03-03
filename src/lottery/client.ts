import { chromium, type Frame, type Locator, type Page } from "playwright";
import type { AppConfig } from "../core/config";
import { AppError, AppErrorCode } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  detectAdditionalAuthRequired,
  extractPurchaseFromStructuredReport,
  extractPurchaseFromText,
  parseKrwAmount
} from "./parsers";
import { mergeSelectorOverrides, type SelectorGroups } from "./selectors";

const TOTAL_STEPS = 5;
type PurchaseSurface = Frame | Page;

export interface RunOnceResult {
  purchasedAt: string;
  drawNo: number;
  gameCount: number;
  numbers: number[][];
  availableDeposit: number;
  requiredDeposit: number;
}

export interface LotteryClientDependencies {
  config: AppConfig;
  logger: Logger;
  notifyStep: (step: number, total: number, description: string) => Promise<void>;
}

export const calculateRequiredAmount = (gameCount: number, pricePerGame: number): number =>
  gameCount * pricePerGame;

export const ensureSufficientDeposit = (availableDeposit: number, requiredDeposit: number): void => {
  if (availableDeposit < requiredDeposit) {
    throw new AppError(AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT, "예치금이 부족합니다.", {
      availableDeposit,
      requiredDeposit
    });
  }
};

export const progressDescription = (step: number, total: number): string => {
  if (total !== TOTAL_STEPS) {
    return `${step}/${total} 단계를 완료했습니다.`;
  }

  switch (step) {
    case 1:
      return "사이트 접속을 완료했습니다.";
    case 2:
      return "로그인을 완료했습니다.";
    case 3:
      return "예치금 확인을 완료했습니다.";
    case 4:
      return "로또 6/45 구매를 완료했습니다.";
    case 5:
      return "로그아웃 및 브라우저 종료를 완료했습니다.";
    default:
      return `${step}/${total} 단계를 완료했습니다.`;
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const bodyText = async (surface: PurchaseSurface): Promise<string> => {
  const text = await surface.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return text ?? "";
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "");

export const pickFirstVisibleIndex = (visibilityStates: boolean[]): number =>
  visibilityStates.findIndex((isVisible) => isVisible);

export const resolvePopupPageIndex = (pageCountBeforeClick: number, pageCountAfterClick: number): number =>
  pageCountAfterClick > pageCountBeforeClick ? pageCountAfterClick - 1 : -1;

export const pickLotto645PurchaseFrameIndex = (frameUrls: string[]): number =>
  frameUrls.findIndex((url) => url.includes("/game645.do"));

export const isLikelyLotto645PurchaseFrame = (frameUrl: string, frameText: string): boolean => {
  if (frameUrl.includes("/game645.do")) {
    return true;
  }

  const normalizedText = frameText.replaceAll(/\s+/g, "");
  const matchedHintCount = ["자동번호발급", "적용수량", "로또구매방법선택"].filter((token) =>
    normalizedText.includes(token)
  ).length;
  return matchedHintCount >= 2;
};

export const hasPurchaseSelectorHints = (counts: {
  gameCount: number;
  autoSelect: number;
  purchaseButton: number;
}): boolean => counts.gameCount > 0 || counts.autoSelect > 0 || counts.purchaseButton > 0;

const countSelectors = async (surface: PurchaseSurface, selectors: string[]): Promise<number> => {
  for (const selector of selectors) {
    const count = await surface.locator(selector).count().catch(() => 0);
    if (count > 0) {
      return count;
    }
  }

  return 0;
};

const findFirstVisibleMatch = async (surface: PurchaseSurface, selector: string): Promise<Locator | null> => {
  const matches = surface.locator(selector);
  const count = await matches.count().catch(() => 0);
  if (count === 0) {
    return null;
  }

  const visibilityStates: boolean[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = matches.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    visibilityStates.push(isVisible);
  }

  const visibleIndex = pickFirstVisibleIndex(visibilityStates);
  return visibleIndex >= 0 ? matches.nth(visibleIndex) : null;
};

const findVisibleLocator = async (
  surface: PurchaseSurface,
  selectors: string[],
  timeoutMs = 4_000
): Promise<Locator | null> => {
  for (const selector of selectors) {
    const locator = await findFirstVisibleMatch(surface, selector);
    if (!locator) {
      continue;
    }

    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      continue;
    }
  }

  return null;
};

const findAttachedLocator = async (
  surface: PurchaseSurface,
  selectors: string[],
  timeoutMs = 4_000
): Promise<Locator | null> => {
  for (const selector of selectors) {
    const locator = await findFirstVisibleMatch(surface, selector);
    if (!locator) {
      continue;
    }

    try {
      await locator.waitFor({ state: "attached", timeout: timeoutMs });
      return locator;
    } catch {
      continue;
    }
  }

  return null;
};

const clickByCandidates = async (
  surface: PurchaseSurface,
  selectors: string[],
  errorCode: AppErrorCode,
  errorMessage: string
): Promise<void> => {
  const locator = await findVisibleLocator(surface, selectors);
  if (!locator) {
    throw new AppError(errorCode, errorMessage, { selectors });
  }

  try {
    await locator.click({ timeout: 5_000 });
  } catch (error) {
    throw new AppError(errorCode, errorMessage, {
      selectors,
      originalError: error instanceof Error ? error.message : String(error)
    });
  }
};

const fillByCandidates = async (
  surface: PurchaseSurface,
  selectors: string[],
  value: string,
  errorCode: AppErrorCode,
  errorMessage: string
): Promise<void> => {
  const locator = await findAttachedLocator(surface, selectors);
  if (!locator) {
    throw new AppError(errorCode, errorMessage, { selectors });
  }

  try {
    await locator.fill(value, { timeout: 5_000 });
  } catch (error) {
    throw new AppError(errorCode, errorMessage, {
      selectors,
      originalError: error instanceof Error ? error.message : String(error)
    });
  }
};

const parseDepositFromPage = async (page: Page, selectors: SelectorGroups): Promise<number> => {
  for (const selector of selectors.depositText) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    const text = await locator.innerText({ timeout: 3_000 }).catch(() => "");
    if (!text) {
      continue;
    }

    try {
      return parseKrwAmount(text);
    } catch {
      continue;
    }
  }

  const fullText = await bodyText(page);
  const depositLine = fullText
    .split("\n")
    .find((line) => line.includes("예치금") || line.includes("보유") || line.includes("잔액"));

  if (!depositLine) {
    throw new AppError(AppErrorCode.ERR05_NAVIGATION_FAILURE, "예치금 정보를 찾을 수 없습니다.");
  }

  try {
    return parseKrwAmount(depositLine);
  } catch {
    throw new AppError(AppErrorCode.ERR05_NAVIGATION_FAILURE, "예치금 금액 파싱에 실패했습니다.", {
      depositLine
    });
  }
};

export const isKnownDhlotteryErrorPage = (url: string, pageText: string): boolean => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("/errorpage")) {
    return true;
  }

  const normalizedText = pageText.replaceAll(" ", "").replaceAll("\n", "");
  return ["잘못된접근", "정상적인경로", "요청하신페이지를찾을수없습니다"].some((token) =>
    normalizedText.includes(token)
  );
};

export const buildLoginUrlCandidates = (baseUrl: string): string[] => [
  `${baseUrl}/login`,
  `${baseUrl}/user.do?method=login&returnUrl=`,
  `${baseUrl}/user.do?method=login`
];

export const buildInitialNavigationUrl = (baseUrl: string): string => buildLoginUrlCandidates(baseUrl)[0];

export const buildPostLoginHomeUrl = (baseUrl: string): string => `${baseUrl}/mypage/home`;

const isCredentialError = (pageText: string): boolean => {
  const normalized = pageText.replaceAll(" ", "");
  return ["아이디혹은비밀번호", "비밀번호가일치하지", "로그인에실패"].some((token) =>
    normalized.includes(token)
  );
};

const applyDialogAutoAccept = (page: Page): void => {
  page.on("dialog", async (dialog) => {
    await dialog.accept().catch(() => undefined);
  });
};

const attemptExtractPurchase = async (
  surface: PurchaseSurface,
  resultAreaSelectors: string[]
): Promise<{ drawNo: number; numbers: number[][] } | null> => {
  const report = surface.locator("#report");
  const reportVisible = await report.isVisible().catch(() => false);
  if (reportVisible) {
    const drawText = await surface.locator("#buyRound").innerText({ timeout: 3_000 }).catch(() => "");
    const rowNumbers = await surface
      .locator("#reportRow li")
      .evaluateAll((rows) =>
        rows
          .map((row) =>
            Array.from(row.querySelectorAll(".nums span"))
              .map((span) => (span.textContent || "").trim())
              .filter((value) => /^\d{1,2}$/.test(value))
          )
          .filter((values) => values.length === 6)
      )
      .catch(() => []);

    if (drawText && rowNumbers.length > 0) {
      try {
        return extractPurchaseFromStructuredReport(drawText, rowNumbers);
      } catch {
        // Fall through to text extraction below.
      }
    }
  }

  const collected: string[] = [];

  for (const selector of resultAreaSelectors) {
    const locator = surface.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    const text = await locator.innerText({ timeout: 3_000 }).catch(() => "");
    if (text) {
      collected.push(text);
    }
  }

  const mergedText = `${collected.join("\n")}\n${await bodyText(surface)}`;
  try {
    return extractPurchaseFromText(mergedText);
  } catch {
    return null;
  }
};

const resolvePurchaseSurface = async (page: Page, selectors: SelectorGroups): Promise<PurchaseSurface> => {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      await frame.waitForLoadState("domcontentloaded", { timeout: 1_500 }).catch(() => undefined);
      const frameText = await frame.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
      const counts = {
        gameCount: await countSelectors(frame, selectors.gameCountSelect),
        autoSelect: await countSelectors(frame, selectors.autoSelectTab),
        purchaseButton: await countSelectors(frame, selectors.purchaseButton)
      };

      if (isLikelyLotto645PurchaseFrame(frame.url(), frameText) || hasPurchaseSelectorHints(counts)) {
        return frame;
      }
    }

    const pageText = await bodyText(page);
    const pageCounts = {
      gameCount: await countSelectors(page, selectors.gameCountSelect),
      autoSelect: await countSelectors(page, selectors.autoSelectTab),
      purchaseButton: await countSelectors(page, selectors.purchaseButton)
    };
    const hasPageSelectors =
      hasPurchaseSelectorHints(pageCounts) || isLikelyLotto645PurchaseFrame(page.url(), pageText);
    if (hasPageSelectors) {
      return page;
    }

    await sleep(1_000);
  }

  return page;
};

const goToPurchasePage = async (
  page: Page,
  baseUrl: string,
  selectors: SelectorGroups
): Promise<PurchaseSurface> => {
  const pageCountBeforeScriptOpen = page.context().pages().length;
  const canUseGameFunction = await page
    .evaluate(() => typeof (window as { gmUtil?: { goGameClsf?: unknown } }).gmUtil?.goGameClsf === "function")
    .catch(() => false);

  if (canUseGameFunction) {
    await page
      .evaluate(() =>
        (window as { gmUtil?: { goGameClsf?: (lottoId: string, purchaseType: string) => void } }).gmUtil?.goGameClsf?.(
          "LO40",
          "PRCHS"
        )
      )
      .catch(() => undefined);
    await sleep(2_000);

    const pagesAfterScriptOpen = page.context().pages();
    const popupPageIndex = resolvePopupPageIndex(pageCountBeforeScriptOpen, pagesAfterScriptOpen.length);
    if (popupPageIndex >= 0) {
      const popupPage = pagesAfterScriptOpen[popupPageIndex];
      applyDialogAutoAccept(popupPage);
      return resolvePurchaseSurface(popupPage, selectors);
    }
  }

  const entry = await findVisibleLocator(page, selectors.lotto645BuyEntry, 2_000);
  if (entry) {
    const pageCountBeforeClick = page.context().pages().length;
    await entry.click({ timeout: 5_000 });
    await sleep(1_500);

    const pagesAfterClick = page.context().pages();
    const popupPageIndex = resolvePopupPageIndex(pageCountBeforeClick, pagesAfterClick.length);
    if (popupPageIndex >= 0) {
      const popupPage = pagesAfterClick[popupPageIndex];
      applyDialogAutoAccept(popupPage);
      return resolvePurchaseSurface(popupPage, selectors);
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    const clickedPageText = await bodyText(page);
    if (clickedPageText.includes("로또") || clickedPageText.includes("구매")) {
      return page;
    }
  }

  const purchaseUrlCandidates = [
    `${baseUrl}/game.do?method=buyLotto`,
    `${baseUrl}/game.do?method=buyLotto&drwNo=latest`
  ];

  for (const url of purchaseUrlCandidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    const text = await bodyText(page);
    if (text.includes("로또") || text.includes("구매")) {
      return resolvePurchaseSurface(page, selectors);
    }
  }

  throw new AppError(AppErrorCode.ERR05_NAVIGATION_FAILURE, "로또 6/45 구매 페이지로 이동하지 못했습니다.");
};

const selectGameCount = async (
  surface: PurchaseSurface,
  selectors: SelectorGroups,
  gameCount: number
): Promise<void> => {
  const select = await findAttachedLocator(surface, selectors.gameCountSelect, 2_500);
  if (select) {
    const value = String(gameCount);
    await select.selectOption([{ value }, { label: value }]).catch(async () => {
      await select.selectOption({ index: gameCount }).catch(() => undefined);
    });
    return;
  }

  const input = await findAttachedLocator(surface, selectors.gameCountInput, 2_500);
  if (input) {
    await input.fill(String(gameCount));
    return;
  }

  throw new AppError(AppErrorCode.ERR06_PURCHASE_FAILURE, "게임 수량 입력 요소를 찾을 수 없습니다.");
};

const tryLoadPurchaseHistoryAndExtract = async (
  surface: PurchaseSurface,
  popupPage: Page,
  baseUrl: string,
  selectors: SelectorGroups
): Promise<{ drawNo: number; numbers: number[][] } | null> => {
  const historyLink = await findVisibleLocator(surface, selectors.purchaseHistoryLink, 2_500);
  if (historyLink) {
    await historyLink.click({ timeout: 5_000 }).catch(() => undefined);
    await popupPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  } else {
    await popupPage
      .goto(`${baseUrl}/myPage.do?method=lottoBuyList`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      })
      .catch(() => undefined);
  }

  const historySurface = popupPage === surface ? popupPage : await resolvePurchaseSurface(popupPage, selectors);
  return attemptExtractPurchase(historySurface, selectors.purchaseHistoryArea);
};

const login = async (
  page: Page,
  selectors: SelectorGroups,
  baseUrl: string,
  id: string,
  password: string,
  logger: Logger
): Promise<void> => {
  const hasLoginForm = async (): Promise<boolean> => {
    const idInput = await findAttachedLocator(page, selectors.loginIdInput, 1_200);
    const passwordInput = await findAttachedLocator(page, selectors.loginPasswordInput, 1_200);
    return Boolean(idInput && passwordInput);
  };

  const loginUrlCandidates = buildLoginUrlCandidates(baseUrl);

  for (const candidate of loginUrlCandidates) {
    await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    const text = await bodyText(page);
    const url = page.url();
    const isErrorPage = isKnownDhlotteryErrorPage(url, text);
    logger.info("로그인 진입 URL 시도", { candidate, currentUrl: url, isErrorPage });
    if (isErrorPage) {
      continue;
    }

    if (await hasLoginForm()) {
      break;
    }
  }

  if (!(await hasLoginForm())) {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await clickByCandidates(
      page,
      selectors.loginButton,
      AppErrorCode.ERR05_NAVIGATION_FAILURE,
      "로그인 버튼을 찾지 못했습니다."
    );
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  }

  if (!(await hasLoginForm())) {
    const text = await bodyText(page);
    const currentUrl = page.url();
    throw new AppError(AppErrorCode.ERR05_NAVIGATION_FAILURE, "아이디 입력 요소를 찾지 못했습니다.", {
      currentUrl,
      isErrorPage: isKnownDhlotteryErrorPage(currentUrl, text)
    });
  }

  await fillByCandidates(
    page,
    selectors.loginIdInput,
    id,
    AppErrorCode.ERR05_NAVIGATION_FAILURE,
    "아이디 입력 요소를 찾지 못했습니다."
  );
  await fillByCandidates(
    page,
    selectors.loginPasswordInput,
    password,
    AppErrorCode.ERR05_NAVIGATION_FAILURE,
    "비밀번호 입력 요소를 찾지 못했습니다."
  );

  await clickByCandidates(
    page,
    selectors.loginSubmitButton,
    AppErrorCode.ERR04_LOGIN_TIMEOUT,
    "로그인 제출 버튼을 찾지 못했습니다."
  );

  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await sleep(1_000);

  const afterLoginText = await bodyText(page);
  if (detectAdditionalAuthRequired(afterLoginText)) {
    throw new AppError(
      AppErrorCode.ERR03_ADDITIONAL_AUTH_REQUIRED,
      "추가 인증(캡차/OTP/휴대폰 인증)이 필요합니다."
    );
  }

  if (isCredentialError(afterLoginText)) {
    throw new AppError(AppErrorCode.ERR02_INVALID_CREDENTIALS, "아이디 또는 비밀번호가 일치하지 않습니다.");
  }

  const loggedIn = await findVisibleLocator(page, selectors.loggedInIndicator, 4_000);
  if (!loggedIn) {
    logger.warn("로그인 성공 요소를 찾지 못해 본문 텍스트로 추가 검증을 시도합니다.");
    if (afterLoginText.includes("로그인") && !afterLoginText.includes("로그아웃")) {
      throw new AppError(AppErrorCode.ERR04_LOGIN_TIMEOUT, "로그인 상태 확인에 실패했습니다.");
    }
  }
};

export const runLotteryPurchaseOnce = async (
  deps: LotteryClientDependencies
): Promise<RunOnceResult> => {
  const { config, logger, notifyStep } = deps;
  const baseUrl = normalizeBaseUrl(config.dhlottery.baseUrl);
  const selectors = mergeSelectorOverrides(config.dhlottery.selectorsOverride);

  logger.info("run-once 로또 구매를 시작합니다.", {
    baseUrl,
    gameCount: config.purchase.gameCount,
    headless: config.browser.headless
  });

  const browser = await chromium.launch({
    headless: config.browser.headless
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 }
  });
  const page = await context.newPage();
  applyDialogAutoAccept(page);

  try {
    const initialUrl = buildInitialNavigationUrl(baseUrl);
    await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    logger.info("사이트 접속 완료", { requestedUrl: initialUrl, url: page.url() });
    await notifyStep(1, TOTAL_STEPS, progressDescription(1, TOTAL_STEPS));

    await login(page, selectors, baseUrl, config.credentials.id, config.credentials.password, logger);
    const mypageHomeUrl = buildPostLoginHomeUrl(baseUrl);
    await page.goto(mypageHomeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    logger.info("로그인 완료", { url: page.url(), mypageHomeUrl });
    await notifyStep(2, TOTAL_STEPS, progressDescription(2, TOTAL_STEPS));

    const availableDeposit = await parseDepositFromPage(page, selectors);
    const requiredDeposit = calculateRequiredAmount(config.purchase.gameCount, config.purchase.pricePerGame);
    logger.info("예치금 확인", { availableDeposit, requiredDeposit });
    ensureSufficientDeposit(availableDeposit, requiredDeposit);
    await notifyStep(3, TOTAL_STEPS, progressDescription(3, TOTAL_STEPS));

    const purchaseSurface = await goToPurchasePage(page, baseUrl, selectors);

    const autoSelect = await findVisibleLocator(purchaseSurface, selectors.autoSelectTab, 2_000);
    if (autoSelect) {
      await autoSelect.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await selectGameCount(purchaseSurface, selectors, config.purchase.gameCount);
    const selectionConfirmButton = await findVisibleLocator(
      purchaseSurface,
      selectors.selectionConfirmButton,
      2_500
    );
    if (selectionConfirmButton) {
      await selectionConfirmButton.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await clickByCandidates(
      purchaseSurface,
      selectors.purchaseButton,
      AppErrorCode.ERR06_PURCHASE_FAILURE,
      "구매하기 버튼을 찾지 못했습니다."
    );

    const finalPurchaseConfirmButton = await findVisibleLocator(
      purchaseSurface,
      selectors.purchaseConfirmButton,
      2_500
    );
    if (finalPurchaseConfirmButton) {
      await finalPurchaseConfirmButton.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await sleep(2_000);
    let purchase = await attemptExtractPurchase(purchaseSurface, selectors.purchaseResultArea);
    if (!purchase) {
      logger.warn("구매 완료 화면에서 번호 추출 실패, 구매내역 페이지 재조회 시도");
      purchase = await tryLoadPurchaseHistoryAndExtract(purchaseSurface, page.context().pages().at(-1) ?? page, baseUrl, selectors);
    }

    if (!purchase) {
      throw new AppError(
        AppErrorCode.ERR07_PURCHASE_HISTORY_NOT_FOUND,
        "구매 완료 후 번호 내역을 찾지 못했습니다."
      );
    }

    logger.info("구매 번호 수집 완료", {
      drawNo: purchase.drawNo,
      games: purchase.numbers.length,
      numbers: purchase.numbers
    });
    await notifyStep(4, TOTAL_STEPS, progressDescription(4, TOTAL_STEPS));

    const logout = await findVisibleLocator(page, selectors.logoutButton, 3_000);
    if (logout) {
      await logout.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await notifyStep(5, TOTAL_STEPS, progressDescription(5, TOTAL_STEPS));

    return {
      purchasedAt: new Date().toISOString(),
      drawNo: purchase.drawNo,
      gameCount: purchase.numbers.length,
      numbers: purchase.numbers,
      availableDeposit,
      requiredDeposit
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AppError(AppErrorCode.ERR08_UNEXPECTED, error.message);
    }

    throw new AppError(AppErrorCode.ERR08_UNEXPECTED, "알 수 없는 오류가 발생했습니다.");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

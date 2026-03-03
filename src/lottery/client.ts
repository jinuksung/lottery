import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type BrowserContextOptions, type Frame, type Locator, type Page } from "playwright";
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

interface PurchaseSelectorCounts {
  gameCount: number;
  gameCountInput: number;
  autoSelect: number;
  purchaseButton: number;
}

interface PurchaseSurfaceProbe {
  target: "page" | "frame";
  url: string;
  counts: PurchaseSelectorCounts;
  textHints: string[];
  matchedByUrl: boolean;
  matchedByText: boolean;
  matchedBySelectors: boolean;
}

interface PurchaseSurfaceResolution {
  selectedTarget: "page" | "frame";
  selectedUrl: string;
  selectedReason: "url" | "text" | "selectors" | "fallback";
  pageUrl: string;
  candidates: PurchaseSurfaceProbe[];
}

interface PopupWaitResult {
  popupPage: Page | null;
  snapshotCounts: number[];
  pageUrls: string[];
}

interface PurchaseNavigationAttempt {
  strategy: string;
  popupSnapshotCounts?: number[];
  popupPageUrls?: string[];
  entryFound?: boolean;
  destinationUrl?: string;
  resolution?: PurchaseSurfaceResolution;
}

interface PurchaseNavigationResult {
  surface: PurchaseSurface;
  page: Page;
  debug: {
    chosenStrategy: string;
    attempts: PurchaseNavigationAttempt[];
  };
}

interface ClickCandidatesOptions {
  preferAttachedDomClick?: boolean;
}

export interface RunOnceResult {
  purchasedAt: string;
  drawNo: number;
  gameCount: number;
  numbers: number[][];
  availableDeposit: number;
  requiredDeposit: number;
}

export interface LotteryClientDependencies {
  cwd?: string;
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

export const truncateLogText = (text: string, maxLength = 240): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;

const bodyText = async (surface: PurchaseSurface): Promise<string> => {
  const text = await surface.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return text ?? "";
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "");
const PURCHASE_SURFACE_TEXT_HINTS = ["자동번호발급", "적용수량", "로또구매방법선택"] as const;
const DESKTOP_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export const pickFirstVisibleIndex = (visibilityStates: boolean[]): number =>
  visibilityStates.findIndex((isVisible) => isVisible);

export const resolvePopupPageIndex = (pageCountBeforeClick: number, pageCountAfterClick: number): number =>
  pageCountAfterClick > pageCountBeforeClick ? pageCountAfterClick - 1 : -1;

export const pickPopupPageIndexFromSnapshots = (
  pageCountBeforeClick: number,
  snapshotCounts: number[]
): number => {
  for (const pageCountAfterClick of snapshotCounts) {
    const popupPageIndex = resolvePopupPageIndex(pageCountBeforeClick, pageCountAfterClick);
    if (popupPageIndex >= 0) {
      return popupPageIndex;
    }
  }

  return -1;
};

export const pickLotto645PurchaseFrameIndex = (frameUrls: string[]): number =>
  frameUrls.findIndex((url) => url.includes("/game645.do"));

export const buildBrowserContextOptions = (): BrowserContextOptions => ({
  viewport: { width: 1400, height: 1000 },
  locale: "ko-KR",
  userAgent: DESKTOP_CHROME_USER_AGENT
});

export const collectPurchaseTextHints = (frameText: string): string[] => {
  const normalizedText = frameText.replaceAll(/\s+/g, "");
  return PURCHASE_SURFACE_TEXT_HINTS.filter((token) => normalizedText.includes(token));
};

export const isLikelyLotto645PurchaseFrame = (frameUrl: string, frameText: string): boolean => {
  if (frameUrl.includes("/game645.do")) {
    return true;
  }

  return collectPurchaseTextHints(frameText).length >= 2;
};

export const hasPurchaseSelectorHints = (counts: {
  gameCount: number;
  gameCountInput?: number;
  autoSelect: number;
  purchaseButton: number;
}): boolean =>
  counts.gameCount > 0 ||
  (counts.gameCountInput ?? 0) > 0 ||
  counts.autoSelect > 0;

const countSelectors = async (surface: PurchaseSurface, selectors: string[]): Promise<number> => {
  for (const selector of selectors) {
    const count = await surface.locator(selector).count().catch(() => 0);
    if (count > 0) {
      return count;
    }
  }

  return 0;
};

const buildPurchaseSelectorCounts = async (
  surface: PurchaseSurface,
  selectors: SelectorGroups
): Promise<PurchaseSelectorCounts> => ({
  gameCount: await countSelectors(surface, selectors.gameCountSelect),
  gameCountInput: await countSelectors(surface, selectors.gameCountInput),
  autoSelect: await countSelectors(surface, selectors.autoSelectTab),
  purchaseButton: await countSelectors(surface, selectors.purchaseButton)
});

const buildPurchaseSurfaceProbe = async (
  surface: PurchaseSurface,
  target: "page" | "frame",
  selectors: SelectorGroups
): Promise<PurchaseSurfaceProbe> => {
  const text = await bodyText(surface);
  const textHints = collectPurchaseTextHints(text);
  return {
    target,
    url: surface.url(),
    counts: await buildPurchaseSelectorCounts(surface, selectors),
    textHints,
    matchedByUrl: surface.url().includes("/game645.do"),
    matchedByText: textHints.length >= 2,
    matchedBySelectors: false
  };
};

const waitForPopupPage = async (
  page: Page,
  pageCountBeforeClick: number,
  timeoutMs: number
): Promise<PopupWaitResult> => {
  const deadline = Date.now() + timeoutMs;
  const snapshotCounts: number[] = [];
  let pageUrls: string[] = [];

  while (Date.now() < deadline) {
    const pages = page.context().pages();
    pageUrls = pages.map((candidatePage) => candidatePage.url());
    snapshotCounts.push(pages.length);
    const popupPageIndex = pickPopupPageIndexFromSnapshots(pageCountBeforeClick, snapshotCounts);
    if (popupPageIndex >= 0) {
      return {
        popupPage: pages[popupPageIndex] ?? null,
        snapshotCounts,
        pageUrls
      };
    }

    await sleep(500);
  }

  return {
    popupPage: null,
    snapshotCounts,
    pageUrls
  };
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

const dismissBlockingAlertIfPresent = async (
  surface: PurchaseSurface,
  selectors: SelectorGroups
): Promise<boolean> => {
  const alertConfirmButton = await findVisibleLocator(surface, selectors.alertConfirmButton, 1_500);
  if (!alertConfirmButton) {
    return false;
  }

  await alertConfirmButton.click({ timeout: 5_000 }).catch(() => undefined);
  await sleep(300);
  return true;
};

const collectPurchaseStageSnapshot = async (
  surface: PurchaseSurface,
  selectors: SelectorGroups
): Promise<Record<string, unknown>> => ({
  surfaceUrl: surface.url(),
  counts: {
    purchaseButton: await countSelectors(surface, selectors.purchaseButton),
    selectionConfirmButton: await countSelectors(surface, selectors.selectionConfirmButton),
    alertConfirmButton: await countSelectors(surface, selectors.alertConfirmButton),
    purchaseConfirmButton: await countSelectors(surface, selectors.purchaseConfirmButton),
    resultArea: await countSelectors(surface, selectors.purchaseResultArea)
  },
  bodyPreview: truncateLogText((await bodyText(surface)).replaceAll(/\s+/g, " ").trim(), 400)
});

const getOwningPage = (surface: PurchaseSurface, fallbackPage: Page): Page =>
  "page" in surface && typeof surface.page === "function" ? surface.page() : fallbackPage;

const waitForPurchaseButtonSurface = async (
  surface: PurchaseSurface,
  page: Page,
  selectors: SelectorGroups
): Promise<PurchaseSurface> => {
  const deadline = Date.now() + 10_000;
  let currentSurface = surface;

  while (Date.now() < deadline) {
    if ((await countSelectors(currentSurface, selectors.purchaseButton)) > 0) {
      return currentSurface;
    }

    await dismissBlockingAlertIfPresent(currentSurface, selectors);

    const ownerPage = getOwningPage(currentSurface, page);
    const resolved = await resolvePurchaseSurface(ownerPage, selectors);
    currentSurface = resolved.surface;
    if ((await countSelectors(currentSurface, selectors.purchaseButton)) > 0) {
      return currentSurface;
    }

    await sleep(500);
  }

  return currentSurface;
};

const clickByCandidates = async (
  surface: PurchaseSurface,
  selectorGroups: SelectorGroups,
  selectors: string[],
  errorCode: AppErrorCode,
  errorMessage: string,
  options: ClickCandidatesOptions = {}
): Promise<void> => {
  const visibleLocator = await findVisibleLocator(surface, selectors);
  const attachedLocator = visibleLocator ? visibleLocator : await findAttachedLocator(surface, selectors);
  const useAttachedDomClick = shouldUseAttachedDomClickFallback(
    Boolean(visibleLocator),
    Boolean(attachedLocator),
    options.preferAttachedDomClick ?? false
  );

  if (!visibleLocator && !useAttachedDomClick) {
    throw new AppError(errorCode, errorMessage, {
      selectors,
      attachedLocatorFound: Boolean(attachedLocator),
      purchaseStageSnapshot: await collectPurchaseStageSnapshot(surface, selectorGroups)
    });
  }

  if (useAttachedDomClick && attachedLocator) {
    try {
      await attachedLocator.evaluate((element) => {
        (element as HTMLElement).click();
      });
      return;
    } catch (error) {
      throw new AppError(errorCode, errorMessage, {
        selectors,
        attachedLocatorFound: true,
        originalError: error instanceof Error ? error.message : String(error),
        purchaseStageSnapshot: await collectPurchaseStageSnapshot(surface, selectorGroups)
      });
    }
  }

  if (!visibleLocator) {
    throw new AppError(errorCode, errorMessage, {
      selectors,
      attachedLocatorFound: Boolean(attachedLocator),
      purchaseStageSnapshot: await collectPurchaseStageSnapshot(surface, selectorGroups)
    });
  }

  const locator = visibleLocator;
  try {
    await locator.click({ timeout: 5_000 });
  } catch (error) {
    const originalError = error instanceof Error ? error.message : String(error);
    if (isAlertInterceptionError(originalError) && (await dismissBlockingAlertIfPresent(surface, selectorGroups))) {
      try {
        await locator.click({ timeout: 5_000 });
        return;
      } catch (retryError) {
        throw new AppError(errorCode, errorMessage, {
          selectors,
          originalError: retryError instanceof Error ? retryError.message : String(retryError),
          purchaseStageSnapshot: await collectPurchaseStageSnapshot(surface, selectorGroups)
        });
      }
    }

    throw new AppError(errorCode, errorMessage, {
      selectors,
      originalError,
      purchaseStageSnapshot: await collectPurchaseStageSnapshot(surface, selectorGroups)
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
export const buildPurchasePageUrlCandidates = (baseUrl: string): string[] => [
  "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40",
  "https://ol.dhlottery.co.kr/olotto/game/game645.do",
  `${baseUrl}/game.do?method=buyLotto`,
  `${baseUrl}/game.do?method=buyLotto&drwNo=latest`
];

export const isConfirmedPurchaseSurfaceReason = (
  reason: "url" | "text" | "selectors" | "fallback"
): boolean => reason !== "fallback";

export const isAlertInterceptionError = (message: string): boolean =>
  message.includes("popupLayerAlert") && message.includes("intercepts pointer events");

export const isLoginPageUrl = (url: string): boolean => {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes("/login") || lowerUrl.includes("method=login");
};

export const shouldTreatMypageRedirectAsLoginFailure = (
  mypageHomeUrl: string,
  currentUrl: string
): boolean => currentUrl !== mypageHomeUrl && isLoginPageUrl(currentUrl);

export const shouldRetryPostLoginHomeNavigation = (
  mypageHomeUrl: string,
  currentUrl: string,
  attempt: number,
  maxAttempts: number
): boolean => attempt < maxAttempts && shouldTreatMypageRedirectAsLoginFailure(mypageHomeUrl, currentUrl);

export const shouldCaptureFailureArtifacts = (code: AppErrorCode): boolean =>
  [
    AppErrorCode.ERR05_NAVIGATION_FAILURE,
    AppErrorCode.ERR06_PURCHASE_FAILURE,
    AppErrorCode.ERR07_PURCHASE_HISTORY_NOT_FOUND
  ].includes(code);

export const shouldUseAttachedDomClickFallback = (
  hasVisibleLocator: boolean,
  hasAttachedLocator: boolean,
  preferAttachedDomClick: boolean
): boolean => !hasVisibleLocator && hasAttachedLocator && preferAttachedDomClick;

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

const waitForLoginSuccess = async (page: Page, selectors: SelectorGroups): Promise<void> => {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const loggedIn = await findVisibleLocator(page, selectors.loggedInIndicator, 500);
    if (loggedIn) {
      return;
    }

    const text = await bodyText(page);
    if (detectAdditionalAuthRequired(text)) {
      throw new AppError(
        AppErrorCode.ERR03_ADDITIONAL_AUTH_REQUIRED,
        "추가 인증(캡차/OTP/휴대폰 인증)이 필요합니다."
      );
    }

    if (isCredentialError(text)) {
      throw new AppError(AppErrorCode.ERR02_INVALID_CREDENTIALS, "아이디 또는 비밀번호가 일치하지 않습니다.");
    }

    const normalizedText = text.replaceAll(/\s+/g, "");
    if (
      !isLoginPageUrl(page.url()) &&
      (normalizedText.includes("로그아웃") || normalizedText.includes("마이페이지"))
    ) {
      return;
    }

    await sleep(500);
  }
};

const navigateToVerifiedMypageHome = async (
  page: Page,
  mypageHomeUrl: string,
  logger: Logger
): Promise<void> => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.goto(mypageHomeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!shouldTreatMypageRedirectAsLoginFailure(mypageHomeUrl, page.url())) {
      return;
    }

    if (!shouldRetryPostLoginHomeNavigation(mypageHomeUrl, page.url(), attempt, maxAttempts)) {
      break;
    }

    logger.warn("마이페이지 접근이 로그인으로 리다이렉트되어 재시도합니다.", {
      attempt,
      maxAttempts,
      currentUrl: page.url(),
      mypageHomeUrl
    });
    await sleep(attempt * 1_000);
  }

  throw new AppError(AppErrorCode.ERR04_LOGIN_TIMEOUT, "로그인 상태 확인에 실패했습니다.", {
    currentUrl: page.url(),
    mypageHomeUrl
  });
};

const sanitizePathPart = (value: string): string => value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");

const captureFailureArtifacts = async (
  cwd: string,
  fallbackPage: Page,
  error: AppError,
  logger: Logger
): Promise<void> => {
  const artifactDir = resolve(
    cwd,
    "logs",
    "diagnostics",
    `${sanitizePathPart(new Date().toISOString())}-${error.code.toLowerCase()}`
  );
  mkdirSync(artifactDir, { recursive: true });

  const pages = fallbackPage.context().pages();
  const manifest: Record<string, unknown> = {
    errorCode: error.code,
    errorMessage: error.message,
    details: error.details,
    artifactDir,
    pageCount: pages.length,
    pages: [] as Array<Record<string, unknown>>
  };

  for (const [pageIndex, candidatePage] of pages.entries()) {
    const pageBase = join(artifactDir, `page-${pageIndex}`);
    const frameSnapshots: Array<Record<string, unknown>> = [];

    await candidatePage.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);

    const pageHtml = await candidatePage.content().catch(() => "");
    writeFileSync(`${pageBase}.html`, pageHtml, "utf8");
    await candidatePage.screenshot({ path: `${pageBase}.png`, fullPage: true }).catch(() => undefined);

    for (const [frameIndex, frame] of candidatePage.frames().entries()) {
      const frameHtml = await frame.content().catch(() => "");
      const frameText = await bodyText(frame).catch(() => "");
      const frameBase = `${pageBase}-frame-${frameIndex}`;
      writeFileSync(`${frameBase}.html`, frameHtml, "utf8");
      frameSnapshots.push({
        frameIndex,
        url: frame.url(),
        bodyPreview: truncateLogText(frameText.replaceAll(/\s+/g, " ").trim(), 400)
      });
    }

    (manifest.pages as Array<Record<string, unknown>>).push({
      pageIndex,
      url: candidatePage.url(),
      title: await candidatePage.title().catch(() => ""),
      frameCount: candidatePage.frames().length,
      frames: frameSnapshots
    });
  }

  writeFileSync(join(artifactDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  logger.warn("브라우저 실패 진단을 저장했습니다.", {
    errorCode: error.code,
    artifactDir,
    pageCount: pages.length
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

const resolvePurchaseSurface = async (
  page: Page,
  selectors: SelectorGroups
): Promise<{ surface: PurchaseSurface; resolution: PurchaseSurfaceResolution }> => {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  const deadline = Date.now() + 15_000;
  let lastCandidates: PurchaseSurfaceProbe[] = [];

  while (Date.now() < deadline) {
    const frames = page.frames();
    const frameCandidates: Array<{ frame: Frame; probe: PurchaseSurfaceProbe }> = [];
    for (const frame of frames) {
      await frame.waitForLoadState("domcontentloaded", { timeout: 1_500 }).catch(() => undefined);
      const probe = await buildPurchaseSurfaceProbe(frame, "frame", selectors);
      probe.matchedBySelectors = hasPurchaseSelectorHints(probe.counts);
      frameCandidates.push({ frame, probe });
    }

    const pageProbe = await buildPurchaseSurfaceProbe(page, "page", selectors);
    pageProbe.matchedBySelectors = hasPurchaseSelectorHints(pageProbe.counts);
    lastCandidates = [...frameCandidates.map((candidate) => candidate.probe), pageProbe];

    const matchedFrameCandidate = frameCandidates.find(
      ({ probe }) => probe.matchedByUrl && (probe.matchedByText || probe.matchedBySelectors)
    );
    if (matchedFrameCandidate) {
      const selectedReason = matchedFrameCandidate.probe.matchedByUrl ? "url" : "text";
      return {
        surface: matchedFrameCandidate.frame,
        resolution: {
          selectedTarget: "frame",
          selectedUrl: matchedFrameCandidate.probe.url,
          selectedReason,
          pageUrl: page.url(),
          candidates: lastCandidates
        }
      };
    }

    const selectorMatchedFrameCandidate = frameCandidates.find(({ probe }) => probe.matchedBySelectors);
    if (selectorMatchedFrameCandidate) {
      return {
        surface: selectorMatchedFrameCandidate.frame,
        resolution: {
          selectedTarget: "frame",
          selectedUrl: selectorMatchedFrameCandidate.probe.url,
          selectedReason: "selectors",
          pageUrl: page.url(),
          candidates: lastCandidates
        }
      };
    }

    if (pageProbe.matchedByText || pageProbe.matchedBySelectors) {
      const selectedReason = pageProbe.matchedByUrl
        ? "url"
        : pageProbe.matchedByText
          ? "text"
          : "selectors";
      return {
        surface: page,
        resolution: {
          selectedTarget: "page",
          selectedUrl: pageProbe.url,
          selectedReason,
          pageUrl: page.url(),
          candidates: lastCandidates
        }
      };
    }

    await sleep(1_000);
  }

  return {
    surface: page,
    resolution: {
      selectedTarget: "page",
      selectedUrl: page.url(),
      selectedReason: "fallback",
      pageUrl: page.url(),
      candidates: lastCandidates
    }
  };
};

const goToPurchasePage = async (
  page: Page,
  baseUrl: string,
  selectors: SelectorGroups
): Promise<PurchaseNavigationResult> => {
  const attempts: PurchaseNavigationAttempt[] = [];
  let preferredDirectNavigationPage: Page = page;
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
    const popupWait = await waitForPopupPage(page, pageCountBeforeScriptOpen, 10_000);
    const attempt: PurchaseNavigationAttempt = {
      strategy: "gmUtil-popup",
      popupSnapshotCounts: popupWait.snapshotCounts,
      popupPageUrls: popupWait.pageUrls
    };
    if (popupWait.popupPage) {
      preferredDirectNavigationPage = popupWait.popupPage;
      applyDialogAutoAccept(popupWait.popupPage);
      const resolved = await resolvePurchaseSurface(popupWait.popupPage, selectors);
      attempt.resolution = resolved.resolution;
      if (isConfirmedPurchaseSurfaceReason(resolved.resolution.selectedReason)) {
        attempts.push(attempt);
        return {
          surface: resolved.surface,
          page: popupWait.popupPage,
          debug: {
            chosenStrategy: attempt.strategy,
            attempts
          }
        };
      }
    }
    attempts.push(attempt);
  }

  const entry = await findVisibleLocator(page, selectors.lotto645BuyEntry, 2_000);
  const entryAttempt: PurchaseNavigationAttempt = {
    strategy: "header-entry",
    entryFound: Boolean(entry)
  };
  if (entry) {
    const pageCountBeforeClick = page.context().pages().length;
    await entry.click({ timeout: 5_000 });
    const popupWait = await waitForPopupPage(page, pageCountBeforeClick, 10_000);
    entryAttempt.popupSnapshotCounts = popupWait.snapshotCounts;
    entryAttempt.popupPageUrls = popupWait.pageUrls;
    if (popupWait.popupPage) {
      preferredDirectNavigationPage = popupWait.popupPage;
      applyDialogAutoAccept(popupWait.popupPage);
      const resolved = await resolvePurchaseSurface(popupWait.popupPage, selectors);
      entryAttempt.resolution = resolved.resolution;
      if (isConfirmedPurchaseSurfaceReason(resolved.resolution.selectedReason)) {
        attempts.push(entryAttempt);
        return {
          surface: resolved.surface,
          page: popupWait.popupPage,
          debug: {
            chosenStrategy: entryAttempt.strategy,
            attempts
          }
        };
      }
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    const clickedPageText = await bodyText(page);
    if (clickedPageText.includes("로또") || clickedPageText.includes("구매")) {
      const resolved = await resolvePurchaseSurface(page, selectors);
      entryAttempt.resolution = resolved.resolution;
      if (isConfirmedPurchaseSurfaceReason(resolved.resolution.selectedReason)) {
        attempts.push(entryAttempt);
        return {
          surface: resolved.surface,
          page,
          debug: {
            chosenStrategy: `${entryAttempt.strategy}-same-page`,
            attempts
          }
        };
      }
    }
  }
  attempts.push(entryAttempt);

  const purchaseUrlCandidates = buildPurchasePageUrlCandidates(baseUrl);

  for (const url of purchaseUrlCandidates) {
    const directAttempt: PurchaseNavigationAttempt = {
      strategy: "direct-url",
      destinationUrl: url
    };
    await preferredDirectNavigationPage
      .goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => undefined);
    const text = await bodyText(preferredDirectNavigationPage);
    if (text.includes("로또") || text.includes("구매")) {
      const resolved = await resolvePurchaseSurface(preferredDirectNavigationPage, selectors);
      directAttempt.resolution = resolved.resolution;
      if (isConfirmedPurchaseSurfaceReason(resolved.resolution.selectedReason)) {
        attempts.push(directAttempt);
        return {
          surface: resolved.surface,
          page: preferredDirectNavigationPage,
          debug: {
            chosenStrategy: directAttempt.strategy,
            attempts
          }
        };
      }
    }
    attempts.push(directAttempt);
  }

  throw new AppError(AppErrorCode.ERR05_NAVIGATION_FAILURE, "로또 6/45 구매 페이지로 이동하지 못했습니다.", {
    purchaseNavigation: {
      chosenStrategy: "unresolved",
      attempts
    }
  });
};

const selectGameCount = async (
  surface: PurchaseSurface,
  selectors: SelectorGroups,
  gameCount: number,
  purchaseDebug: PurchaseNavigationResult["debug"]
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

  throw new AppError(AppErrorCode.ERR06_PURCHASE_FAILURE, "게임 수량 입력 요소를 찾을 수 없습니다.", {
    purchaseNavigation: purchaseDebug,
    surfaceSnapshot: await buildPurchaseSurfaceProbe(
      surface,
      purchaseDebug.attempts.at(-1)?.resolution?.selectedTarget ?? "page",
      selectors
    )
  });
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

  const historySurface =
    popupPage === surface ? popupPage : (await resolvePurchaseSurface(popupPage, selectors)).surface;
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
      selectors,
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
    selectors,
    selectors.loginSubmitButton,
    AppErrorCode.ERR04_LOGIN_TIMEOUT,
    "로그인 제출 버튼을 찾지 못했습니다."
  );

  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await waitForLoginSuccess(page, selectors);
  await sleep(500);

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
  const { config, logger, notifyStep, cwd } = deps;
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
    ...buildBrowserContextOptions()
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
    await navigateToVerifiedMypageHome(page, mypageHomeUrl, logger);
    logger.info("로그인 완료", { url: page.url(), mypageHomeUrl });
    await notifyStep(2, TOTAL_STEPS, progressDescription(2, TOTAL_STEPS));

    const availableDeposit = await parseDepositFromPage(page, selectors);
    const requiredDeposit = calculateRequiredAmount(config.purchase.gameCount, config.purchase.pricePerGame);
    logger.info("예치금 확인", { availableDeposit, requiredDeposit });
    ensureSufficientDeposit(availableDeposit, requiredDeposit);
    await notifyStep(3, TOTAL_STEPS, progressDescription(3, TOTAL_STEPS));

    const purchaseNavigation = await goToPurchasePage(page, baseUrl, selectors);
    let purchaseSurface = purchaseNavigation.surface;
    logger.info("로또 구매 surface 선택", purchaseNavigation.debug);

    const autoSelect = await findVisibleLocator(purchaseSurface, selectors.autoSelectTab, 2_000);
    if (autoSelect) {
      await autoSelect.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await selectGameCount(purchaseSurface, selectors, config.purchase.gameCount, purchaseNavigation.debug);
    const selectionConfirmButton = await findVisibleLocator(
      purchaseSurface,
      selectors.selectionConfirmButton,
      2_500
    );
    if (selectionConfirmButton) {
      await selectionConfirmButton.click({ timeout: 5_000 }).catch(() => undefined);
      await dismissBlockingAlertIfPresent(purchaseSurface, selectors);
    }

    purchaseSurface = await waitForPurchaseButtonSurface(
      purchaseSurface,
      purchaseNavigation.page,
      selectors
    );

    await clickByCandidates(
      purchaseSurface,
      selectors,
      selectors.purchaseButton,
      AppErrorCode.ERR06_PURCHASE_FAILURE,
      "구매하기 버튼을 찾지 못했습니다.",
      { preferAttachedDomClick: true }
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
    if (cwd && error instanceof AppError && shouldCaptureFailureArtifacts(error.code)) {
      await captureFailureArtifacts(cwd, page, error, logger).catch((captureError) => {
        logger.warn("브라우저 실패 진단 저장에 실패했습니다.", {
          errorCode: error.code,
          message: captureError instanceof Error ? captureError.message : String(captureError)
        });
      });
    }

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

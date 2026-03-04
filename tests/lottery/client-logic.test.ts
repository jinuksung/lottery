import { describe, expect, test } from "vitest";
import { AppErrorCode } from "../../src/core/errors";
import {
  buildBrowserContextOptions,
  buildPurchaseContextSnapshot,
  buildPurchasePageUrlCandidates,
  buildInitialNavigationUrl,
  buildLoginUrlCandidates,
  buildPostLoginHomeUrl,
  calculateRequiredAmount,
  ensureSufficientDeposit,
  hasPurchaseSelectorHints,
  isConfirmedPurchaseSurfaceReason,
  isAlertInterceptionError,
  isLoginPageUrl,
  shouldCaptureFailureArtifacts,
  shouldDisableSelectionConfirmAfterPopupLoss,
  shouldRetryPrepareAfterPopupLoss,
  shouldRetryAfterLostPurchaseSurface,
  shouldRetryPostLoginHomeNavigation,
  shouldUseAttachedDomClickFallback,
  shouldTreatMypageRedirectAsLoginFailure,
  truncateLogText,
  isKnownDhlotteryErrorPage,
  isLikelyLotto645PurchaseFrame,
  pickPopupPageIndexFromSnapshots,
  pickLotto645PurchaseFrameIndex,
  pickFirstVisibleIndex,
  resolvePopupPageIndex,
  progressDescription
} from "../../src/lottery/client";

describe("lottery/client logic", () => {
  test("calculates required amount by game count", () => {
    expect(calculateRequiredAmount(5, 1000)).toBe(5000);
  });

  test("throws Err01 when deposit is insufficient", () => {
    try {
      ensureSufficientDeposit(3000, 5000);
      throw new Error("expected error");
    } catch (error) {
      expect(error).toHaveProperty("code", AppErrorCode.ERR01_INSUFFICIENT_DEPOSIT);
    }
  });

  test("builds section progress descriptions", () => {
    expect(progressDescription(2, 5)).toContain("로그인을 완료했습니다");
  });

  test("detects dhlottery error page response", () => {
    expect(isKnownDhlotteryErrorPage("https://www.dhlottery.co.kr/errorPage", "동행복권")).toBe(true);
    expect(
      isKnownDhlotteryErrorPage(
        "https://www.dhlottery.co.kr/common.do?method=main",
        "잘못된 접근입니다. 정상적인 경로를 이용해주세요."
      )
    ).toBe(true);
    expect(
      isKnownDhlotteryErrorPage("https://www.dhlottery.co.kr/user.do?method=login&returnUrl=", "로그인")
    ).toBe(false);
  });

  test("prefers /login as the first login url candidate", () => {
    const candidates = buildLoginUrlCandidates("https://www.dhlottery.co.kr");
    expect(candidates[0]).toBe("https://www.dhlottery.co.kr/login");
  });

  test("uses login page as the initial navigation target", () => {
    expect(buildInitialNavigationUrl("https://www.dhlottery.co.kr")).toBe(
      "https://www.dhlottery.co.kr/login"
    );
  });

  test("uses mypage home as the post-login deposit check target", () => {
    expect(buildPostLoginHomeUrl("https://www.dhlottery.co.kr")).toBe(
      "https://www.dhlottery.co.kr/mypage/home"
    );
  });

  test("includes verified popup urls as purchase page fallbacks", () => {
    expect(buildPurchasePageUrlCandidates("https://www.dhlottery.co.kr").slice(0, 2)).toEqual([
      "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40",
      "https://ol.dhlottery.co.kr/olotto/game/game645.do"
    ]);
  });

  test("uses a fixed desktop browser context to avoid mobile redirects", () => {
    const options = buildBrowserContextOptions();
    expect(options.viewport).toEqual({ width: 1400, height: 1000 });
    expect(options.userAgent).toContain("Chrome");
    expect(options.userAgent).not.toContain("HeadlessChrome");
    expect(options.locale).toBe("ko-KR");
  });

  test("prefers the first visible match over earlier hidden matches", () => {
    expect(pickFirstVisibleIndex([false, true, true])).toBe(1);
    expect(pickFirstVisibleIndex([false, false])).toBe(-1);
    expect(pickFirstVisibleIndex([true, false])).toBe(0);
  });

  test("uses the newest page when popup window is opened", () => {
    expect(resolvePopupPageIndex(1, 2)).toBe(1);
    expect(resolvePopupPageIndex(2, 4)).toBe(3);
    expect(resolvePopupPageIndex(2, 2)).toBe(-1);
  });

  test("detects a popup that appears after delayed page-count snapshots", () => {
    expect(pickPopupPageIndexFromSnapshots(1, [1, 1, 2])).toBe(1);
    expect(pickPopupPageIndexFromSnapshots(2, [2, 2, 4])).toBe(3);
    expect(pickPopupPageIndexFromSnapshots(2, [2, 2, 2])).toBe(-1);
  });

  test("prefers the lotto645 inner frame when popup hosts the real purchase ui in an iframe", () => {
    expect(
      pickLotto645PurchaseFrameIndex([
        "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40",
        "https://ol.dhlottery.co.kr/olotto/game/game645.do",
        "https://www.youtube.com/embed/U0g0LyuwRx4?enablejsapi=1"
      ])
    ).toBe(1);
    expect(
      pickLotto645PurchaseFrameIndex(["https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40"])
    ).toBe(-1);
  });

  test("recognizes lotto645 purchase frame by url or loaded text hints", () => {
    expect(
      isLikelyLotto645PurchaseFrame(
        "https://ol.dhlottery.co.kr/olotto/game/game645.do",
        "로또 구매방법 선택 적용수량 구매하기"
      )
    ).toBe(true);
    expect(
      isLikelyLotto645PurchaseFrame(
        "about:blank",
        "자동번호발급 구매 수량 전체를 자동번호로 발급 받을 수 있습니다. 적용수량"
      )
    ).toBe(true);
    expect(isLikelyLotto645PurchaseFrame("https://www.youtube.com/embed/abc", "video")).toBe(false);
  });

  test("treats purchase surface as ready when key selectors are present", () => {
    expect(hasPurchaseSelectorHints({ gameCount: 1, autoSelect: 0, purchaseButton: 0 })).toBe(true);
    expect(hasPurchaseSelectorHints({ gameCount: 0, gameCountInput: 1, autoSelect: 0, purchaseButton: 0 })).toBe(
      true
    );
    expect(hasPurchaseSelectorHints({ gameCount: 0, autoSelect: 1, purchaseButton: 0 })).toBe(true);
    expect(hasPurchaseSelectorHints({ gameCount: 0, autoSelect: 0, purchaseButton: 1 })).toBe(false);
    expect(hasPurchaseSelectorHints({ gameCount: 0, autoSelect: 0, purchaseButton: 0 })).toBe(false);
  });

  test("does not treat fallback purchase resolutions as confirmed", () => {
    expect(isConfirmedPurchaseSurfaceReason("fallback")).toBe(false);
    expect(isConfirmedPurchaseSurfaceReason("url")).toBe(true);
    expect(isConfirmedPurchaseSurfaceReason("text")).toBe(true);
    expect(isConfirmedPurchaseSurfaceReason("selectors")).toBe(true);
  });

  test("detects popup alert interception during purchase button click", () => {
    expect(
      isAlertInterceptionError(
        "locator.click: <div class=\"layer-alert\" id=\"popupLayerAlert\">…</div> intercepts pointer events"
      )
    ).toBe(true);
    expect(isAlertInterceptionError("locator.click: element is not attached")).toBe(false);
  });

  test("recognizes login page urls for post-login validation", () => {
    expect(isLoginPageUrl("https://www.dhlottery.co.kr/login")).toBe(true);
    expect(isLoginPageUrl("https://www.dhlottery.co.kr/user.do?method=login")).toBe(true);
    expect(isLoginPageUrl("https://www.dhlottery.co.kr/mypage/home")).toBe(false);
  });

  test("treats mypage redirect back to login as login failure", () => {
    expect(
      shouldTreatMypageRedirectAsLoginFailure(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/login"
      )
    ).toBe(true);
    expect(
      shouldTreatMypageRedirectAsLoginFailure(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/mypage/home"
      )
    ).toBe(false);
  });

  test("retries post-login mypage navigation while session is still settling", () => {
    expect(
      shouldRetryPostLoginHomeNavigation(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/login",
        1,
        3
      )
    ).toBe(true);
    expect(
      shouldRetryPostLoginHomeNavigation(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/user.do?method=login",
        2,
        3
      )
    ).toBe(true);
    expect(
      shouldRetryPostLoginHomeNavigation(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/login",
        3,
        3
      )
    ).toBe(false);
    expect(
      shouldRetryPostLoginHomeNavigation(
        "https://www.dhlottery.co.kr/mypage/home",
        "https://www.dhlottery.co.kr/mypage/home",
        1,
        3
      )
    ).toBe(false);
  });

  test("captures browser diagnostics only for navigation and purchase failures", () => {
    expect(shouldCaptureFailureArtifacts(AppErrorCode.ERR04_LOGIN_TIMEOUT)).toBe(false);
    expect(shouldCaptureFailureArtifacts(AppErrorCode.ERR05_NAVIGATION_FAILURE)).toBe(true);
    expect(shouldCaptureFailureArtifacts(AppErrorCode.ERR06_PURCHASE_FAILURE)).toBe(true);
    expect(shouldCaptureFailureArtifacts(AppErrorCode.ERR07_PURCHASE_HISTORY_NOT_FOUND)).toBe(true);
    expect(shouldCaptureFailureArtifacts(AppErrorCode.ERR08_UNEXPECTED)).toBe(false);
  });

  test("retries purchase preparation when the popup disappears and the surface goes blank", () => {
    expect(
      shouldRetryAfterLostPurchaseSurface(1, 3, {
        counts: {
          purchaseButton: 0,
          selectionConfirmButton: 0,
          alertConfirmButton: 0,
          purchaseConfirmButton: 0,
          resultArea: 0
        },
        bodyPreview: ""
      })
    ).toBe(true);
    expect(
      shouldRetryAfterLostPurchaseSurface(3, 3, {
        counts: {
          purchaseButton: 0,
          selectionConfirmButton: 0,
          alertConfirmButton: 0,
          purchaseConfirmButton: 0,
          resultArea: 0
        },
        bodyPreview: ""
      })
    ).toBe(false);
    expect(
      shouldRetryAfterLostPurchaseSurface(1, 3, {
        counts: {
          purchaseButton: 1,
          selectionConfirmButton: 0,
          alertConfirmButton: 0,
          purchaseConfirmButton: 0,
          resultArea: 0
        },
        bodyPreview: ""
      })
    ).toBe(false);
    expect(
      shouldRetryAfterLostPurchaseSurface(1, 3, {
        counts: {
          purchaseButton: 0,
          selectionConfirmButton: 0,
          alertConfirmButton: 0,
          purchaseConfirmButton: 0,
          resultArea: 0
        },
        bodyPreview: "로또구매방법선택"
      })
    ).toBe(false);
  });

  test("disables selection-confirm click after popup-loss signal", () => {
    expect(shouldDisableSelectionConfirmAfterPopupLoss(undefined)).toBe(false);
    expect(shouldDisableSelectionConfirmAfterPopupLoss({ popupLostAfterSelectionConfirm: false })).toBe(false);
    expect(shouldDisableSelectionConfirmAfterPopupLoss({ popupLostAfterSelectionConfirm: true })).toBe(true);
  });

  test("retries purchase-prepare flow while popup-loss signal is present", () => {
    expect(shouldRetryPrepareAfterPopupLoss(1, 3, { popupLostAfterSelectionConfirm: true })).toBe(true);
    expect(shouldRetryPrepareAfterPopupLoss(2, 3, { popupLostAfterSelectionConfirm: true })).toBe(true);
    expect(shouldRetryPrepareAfterPopupLoss(3, 3, { popupLostAfterSelectionConfirm: true })).toBe(false);
    expect(shouldRetryPrepareAfterPopupLoss(1, 3, { popupLostAfterSelectionConfirm: false })).toBe(false);
  });

  test("allows attached dom click fallback only when explicitly requested", () => {
    expect(shouldUseAttachedDomClickFallback(false, true, true)).toBe(true);
    expect(shouldUseAttachedDomClickFallback(false, false, true)).toBe(false);
    expect(shouldUseAttachedDomClickFallback(true, true, true)).toBe(false);
    expect(shouldUseAttachedDomClickFallback(false, true, false)).toBe(false);
  });

  test("truncates long diagnostic text for logs", () => {
    expect(truncateLogText("abc", 5)).toBe("abc");
    expect(truncateLogText("abcdefghij", 5)).toBe("abcde...");
  });

  test("builds a purchase context snapshot for stage-by-stage diagnostics", () => {
    expect(
      buildPurchaseContextSnapshot(
        ["https://www.dhlottery.co.kr/mypage/home", "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40"],
        "https://www.dhlottery.co.kr/mypage/home",
        "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40",
        "https://ol.dhlottery.co.kr/olotto/game/game645.do"
      )
    ).toEqual({
      openPageCount: 2,
      pageUrls: [
        "https://www.dhlottery.co.kr/mypage/home",
        "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40"
      ],
      activePageUrl: "https://www.dhlottery.co.kr/mypage/home",
      ownerPageUrl: "https://el.dhlottery.co.kr/game/TotalGame.jsp?LottoId=LO40",
      surfaceUrl: "https://ol.dhlottery.co.kr/olotto/game/game645.do"
    });
  });
});

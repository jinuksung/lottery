import { describe, expect, test } from "vitest";
import { DEFAULT_SELECTORS } from "../../src/lottery/selectors";

describe("lottery/selectors", () => {
  test("prefers visible login inputs from the real login page", () => {
    expect(DEFAULT_SELECTORS.loginIdInput[0]).toBe("input#inpUserId");
    expect(DEFAULT_SELECTORS.loginPasswordInput[0]).toBe("input#inpUserPswdEncn");
    expect(DEFAULT_SELECTORS.loginSubmitButton[0]).toBe("button#btnLogin");
  });

  test("supports direct lotto purchase triggers exposed by the header", () => {
    expect(DEFAULT_SELECTORS.lotto645BuyEntry[0]).toBe("#lt645ImdtPrchs .btn-buying1");
    expect(DEFAULT_SELECTORS.lotto645BuyEntry).toContain("#lt645ImdtPrchs");
  });

  test("prefers purchase-available amount on mypage home for deposit checks", () => {
    expect(DEFAULT_SELECTORS.depositText[0]).toBe("#divCrntEntrsAmt");
    expect(DEFAULT_SELECTORS.depositText).toContain("#totalAmt");
  });

  test("matches the real popup controls for auto purchase", () => {
    expect(DEFAULT_SELECTORS.autoSelectTab[0]).toBe("a#num2");
    expect(DEFAULT_SELECTORS.gameCountSelect[0]).toBe("select#amoundApply");
    expect(DEFAULT_SELECTORS.selectionConfirmButton[0]).toBe("input#btnSelectNum");
    expect(DEFAULT_SELECTORS.selectionConfirmButton).not.toContain("input[value='확인']");
    expect(DEFAULT_SELECTORS.alertConfirmButton[0]).toBe("#popupLayerAlert input[value='확인']");
    expect(DEFAULT_SELECTORS.purchaseConfirmButton[0]).toBe("#popupLayerConfirm input[value='확인']");
    expect(DEFAULT_SELECTORS.purchaseConfirmButton).not.toContain("text=확인");
    expect(DEFAULT_SELECTORS.purchaseButton[0]).toBe("button#btnBuy");
  });
});

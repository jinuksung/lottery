import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/core/config";

describe("core/config", () => {
  const baseEnv = {
    DHL_ID: "user",
    DHL_PASSWORD: "pass",
    LOTTO_GAME_COUNT: "3",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_CHAT_ID: "chat"
  };

  test("parses required env variables", () => {
    const config = loadConfig(baseEnv);

    expect(config.credentials.id).toBe("user");
    expect(config.purchase.gameCount).toBe(3);
    expect(config.telegram.botToken).toBe("token");
    expect(config.browser.headless).toBe(true);
  });

  test("rejects non-positive LOTTO_GAME_COUNT", () => {
    expect(() => loadConfig({ ...baseEnv, LOTTO_GAME_COUNT: "0" })).toThrow(
      "LOTTO_GAME_COUNT"
    );
  });

  test("supports explicit browser headless false", () => {
    const config = loadConfig({ ...baseEnv, BROWSER_HEADLESS: "false" });

    expect(config.browser.headless).toBe(false);
  });
});

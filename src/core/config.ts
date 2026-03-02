export interface AppConfig {
  credentials: {
    id: string;
    password: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  purchase: {
    gameCount: number;
    pricePerGame: number;
  };
  browser: {
    headless: boolean;
  };
  dhlottery: {
    baseUrl: string;
    selectorsOverride?: Record<string, string>;
  };
}

type EnvLike = Record<string, string | undefined>;

const requiredString = (env: EnvLike, key: string): string => {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
};

const parsePositiveInt = (value: string, key: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
};

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(`BROWSER_HEADLESS must be true or false`);
};

const parseSelectorsOverride = (value: string | undefined): Record<string, string> | undefined => {
  if (!value || value.trim() === "") {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DHL_SELECTORS_JSON must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("DHL_SELECTORS_JSON must be an object");
  }

  const entries = Object.entries(parsed);
  for (const [key, selector] of entries) {
    if (typeof selector !== "string" || selector.trim() === "") {
      throw new Error(`DHL_SELECTORS_JSON.${key} must be a non-empty string`);
    }
  }

  return Object.fromEntries(entries);
};

export const loadConfig = (env: EnvLike = process.env): AppConfig => {
  const id = requiredString(env, "DHL_ID");
  const password = requiredString(env, "DHL_PASSWORD");
  const gameCount = parsePositiveInt(requiredString(env, "LOTTO_GAME_COUNT"), "LOTTO_GAME_COUNT");
  const botToken = requiredString(env, "TELEGRAM_BOT_TOKEN");
  const chatId = requiredString(env, "TELEGRAM_CHAT_ID");
  const headless = parseBoolean(env.BROWSER_HEADLESS, true);
  const baseUrl = env.DHL_BASE_URL?.trim() || "https://www.dhlottery.co.kr";
  const selectorsOverride = parseSelectorsOverride(env.DHL_SELECTORS_JSON);

  return {
    credentials: { id, password },
    telegram: { botToken, chatId },
    purchase: {
      gameCount,
      pricePerGame: 1000
    },
    browser: { headless },
    dhlottery: {
      baseUrl,
      selectorsOverride
    }
  };
};

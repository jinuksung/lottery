export interface TelegramClient {
  send(message: string): Promise<void>;
}

interface TelegramClientOptions {
  botToken: string;
  chatId: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

interface TelegramApiErrorPayload {
  parameters?: {
    retry_after?: number;
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseRetryDelayMs = async (response: Response): Promise<number | undefined> => {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const retrySeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
      return retrySeconds * 1000;
    }
  }

  try {
    const payload = (await response.json()) as TelegramApiErrorPayload;
    const retryAfterSeconds = payload.parameters?.retry_after;
    if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

export const createTelegramClient = (options: TelegramClientOptions): TelegramClient => {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const endpoint = `https://api.telegram.org/bot${options.botToken}/sendMessage`;

  const sendRequest = async (message: string): Promise<Response> =>
    fetchFn(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: options.chatId,
        text: message
      })
    });

  return {
    async send(message: string): Promise<void> {
      const firstResponse = await sendRequest(message);
      if (firstResponse.ok) {
        return;
      }

      if (firstResponse.status === 429) {
        const retryDelayMs = (await parseRetryDelayMs(firstResponse)) ?? 1000;
        await sleepFn(retryDelayMs);

        const retryResponse = await sendRequest(message);
        if (retryResponse.ok) {
          return;
        }

        throw new Error(`Telegram API request failed after retry: ${retryResponse.status}`);
      }

      throw new Error(`Telegram API request failed: ${firstResponse.status}`);
    }
  };
};

export const formatProgressMessage = (step: number, totalSteps: number, description: string): string =>
  `로또 구매를 진행 중입니다 (${step}/${totalSteps}) - ${description}`;

export const formatErrorMessage = (errorCode: string, message: string): string =>
  `로또 구매 중 오류가 발생했습니다 [${errorCode}] ${message}`;

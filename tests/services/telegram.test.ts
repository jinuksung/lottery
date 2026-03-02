import { describe, expect, test, vi } from "vitest";
import { createTelegramClient } from "../../src/services/telegram";

describe("services/telegram", () => {
  test("sends message to telegram bot api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      headers: { get: () => null }
    });

    const client = createTelegramClient({
      botToken: "token",
      chatId: "chat",
      fetchFn: fetchMock,
      sleepFn: async () => undefined
    });

    await client.send("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/bottoken/sendMessage");
  });

  test("retries once when telegram returns 429", async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ parameters: { retry_after: 2 } }),
        headers: { get: () => null }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        headers: { get: () => null }
      });

    const client = createTelegramClient({
      botToken: "token",
      chatId: "chat",
      fetchFn: fetchMock,
      sleepFn: sleepMock
    });

    await client.send("rate limited");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  test("throws when second attempt still fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false }),
      headers: { get: () => null }
    });

    const client = createTelegramClient({
      botToken: "token",
      chatId: "chat",
      fetchFn: fetchMock,
      sleepFn: async () => undefined
    });

    await expect(client.send("boom")).rejects.toThrow("Telegram API request failed");
  });
});

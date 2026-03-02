import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { appendPurchaseHistory } from "../../src/services/purchaseHistory";

describe("services/purchaseHistory", () => {
  test("appends jsonl records without overwriting existing content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lottery-history-"));
    const historyPath = join(dir, "purchase-history.jsonl");

    await appendPurchaseHistory(historyPath, {
      purchasedAt: "2026-02-27T12:00:00.000Z",
      drawNo: 1171,
      gameCount: 2,
      numbers: [
        [1, 2, 3, 4, 5, 6],
        [11, 12, 13, 14, 15, 16]
      ]
    });

    await appendPurchaseHistory(historyPath, {
      purchasedAt: "2026-02-27T12:05:00.000Z",
      drawNo: 1171,
      gameCount: 1,
      numbers: [[7, 8, 9, 10, 11, 12]]
    });

    const saved = await readFile(historyPath, "utf8");
    const lines = saved.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).gameCount).toBe(2);
    expect(JSON.parse(lines[1]).numbers[0][0]).toBe(7);
  });
});

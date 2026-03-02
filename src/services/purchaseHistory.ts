import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface PurchaseRecord {
  purchasedAt: string;
  drawNo: number;
  gameCount: number;
  numbers: number[][];
}

export const appendPurchaseHistory = async (
  filePath: string,
  record: PurchaseRecord
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
};

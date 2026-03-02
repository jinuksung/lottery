import { describe, expect, test } from "vitest";
import {
  detectAdditionalAuthRequired,
  extractPurchaseFromStructuredReport,
  extractPurchaseFromText,
  parseKrwAmount
} from "../../src/lottery/parsers";

describe("lottery/parsers", () => {
  test("parses krw amount text", () => {
    expect(parseKrwAmount("예치금 12,000원")).toBe(12000);
    expect(parseKrwAmount("보유금액: 3000 원")).toBe(3000);
  });

  test("detects captcha/additional auth keywords", () => {
    expect(detectAdditionalAuthRequired("보안문자를 입력하세요")).toBe(true);
    expect(detectAdditionalAuthRequired("OTP 인증 필요")).toBe(true);
    expect(detectAdditionalAuthRequired("정상 로그인")).toBe(false);
  });

  test("extracts draw and numbers from text block", () => {
    const text = "1171회\nA\t자동\t1, 2, 3, 4, 5, 6\nB\t자동\t11,12,13,14,15,16";
    const parsed = extractPurchaseFromText(text);

    expect(parsed.drawNo).toBe(1171);
    expect(parsed.numbers).toHaveLength(2);
    expect(parsed.numbers[0]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("extracts draw and numbers from structured purchase report rows", () => {
    const parsed = extractPurchaseFromStructuredReport("제 1214회", [
      ["01", "12", "23", "34", "35", "45"],
      ["2", "4", "6", "8", "10", "12"]
    ]);

    expect(parsed.drawNo).toBe(1214);
    expect(parsed.numbers).toEqual([
      [1, 12, 23, 34, 35, 45],
      [2, 4, 6, 8, 10, 12]
    ]);
  });
});

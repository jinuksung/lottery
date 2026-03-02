export interface ParsedPurchase {
  drawNo: number;
  numbers: number[][];
}

export const parseKrwAmount = (text: string): number => {
  const match = text.match(/([0-9][0-9,]*)\s*원?/);
  if (!match) {
    throw new Error(`Cannot parse amount from text: ${text}`);
  }

  return Number.parseInt(match[1].replaceAll(",", ""), 10);
};

export const detectAdditionalAuthRequired = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return [
    "보안문자",
    "캡차",
    "captcha",
    "otp",
    "추가 인증",
    "2차 인증",
    "인증 필요",
    "휴대폰 인증"
  ].some((keyword) => normalized.includes(keyword));
};

export const extractPurchaseFromText = (text: string): ParsedPurchase => {
  const drawMatch = text.match(/(\d+)\s*회/);
  if (!drawMatch) {
    throw new Error("Draw number not found in purchase text");
  }

  const numberMatches = text.match(/\b\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\b/g);
  if (!numberMatches || numberMatches.length === 0) {
    throw new Error("Lotto numbers not found in purchase text");
  }

  const numbers = numberMatches.map((line) =>
    line
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => Number.isFinite(value))
  );

  return {
    drawNo: Number.parseInt(drawMatch[1], 10),
    numbers
  };
};

export const extractPurchaseFromStructuredReport = (
  drawText: string,
  numberRows: string[][]
): ParsedPurchase => {
  const drawMatch = drawText.match(/(\d+)\s*회/);
  if (!drawMatch) {
    throw new Error("Draw number not found in purchase report");
  }

  const numbers = numberRows.map((row) =>
    row
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value))
  );

  if (numbers.length === 0 || numbers.some((row) => row.length !== 6)) {
    throw new Error("Structured lotto numbers not found in purchase report");
  }

  return {
    drawNo: Number.parseInt(drawMatch[1], 10),
    numbers
  };
};

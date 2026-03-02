# Lotto Run-Once Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript run-once CLI that opens dhlottery in a new headless browser session, logs in, checks deposit, buys Lotto 6/45 automatic N games, records purchased numbers by draw, sends Telegram progress/error updates, logs out, and closes the browser.

**Architecture:** Use a layered Node.js design: `index.ts` orchestrates flow, `lottery/` handles Playwright site actions, `services/` handles Telegram and history persistence, and `core/` handles config/errors/logging. Error codes are represented as typed domain errors mapped to process exit codes for scheduler-friendly retries.

**Tech Stack:** TypeScript, Node.js 20+, Playwright, Vitest, dotenv.

---

### Task 1: Bootstrap TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Write the failing test**
No production behavior yet. Skip test for scaffold-only task.

**Step 2: Add minimal project setup**
- Add scripts: `build`, `test`, `run-once`.
- Add dependencies: `playwright`, `dotenv`.
- Add dev dependencies: `typescript`, `vitest`, `@types/node`.
- Configure TS output to `dist/`.

**Step 3: Verify tooling works**
Run: `npm test -- --run`
Expected: test runner executes (can be 0 tests at this moment).

**Step 4: Commit**
Run:
```bash
git add package.json tsconfig.json .gitignore .env.example
git commit -m "chore: bootstrap typescript run-once project"
```

### Task 2: Define error model with exit code mapping

**Files:**
- Create: `src/core/errors.ts`
- Test: `tests/core/errors.test.ts`

**Step 1: Write the failing test**
Test requirements:
- `Err01` (insufficient deposit) maps to dedicated non-zero exit code.
- Unknown/internal error maps to generic exit code.
- Domain error renders formatted message.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/core/errors.test.ts --run`
Expected: FAIL (module/function missing).

**Step 3: Write minimal implementation**
- Create `AppErrorCode` enum (`Err01`~`Err08`).
- Create `AppError` class with `code`, `details`.
- Implement `exitCodeForError(err)`.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/core/errors.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/errors.ts tests/core/errors.test.ts
git commit -m "feat: add typed app errors and exit code mapping"
```

### Task 3: Implement env config parser

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Required env vars are validated.
- `LOTTO_GAME_COUNT` must be positive integer.
- `BROWSER_HEADLESS` defaults to `true`.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/core/config.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Parse and validate env.
- Return typed `AppConfig`.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/core/config.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add runtime env configuration parser"
```

### Task 4: Implement structured logger

**Files:**
- Create: `src/core/logger.ts`
- Test: `tests/core/logger.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Logger writes formatted lines to file.
- Logger prints to console-compatible stream.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/core/logger.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Implement levels (`INFO`, `WARN`, `ERROR`).
- Write to `logs/run-once.log` and stdout/stderr.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/core/logger.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/core/logger.ts tests/core/logger.test.ts
git commit -m "feat: add dual-output logger"
```

### Task 5: Implement Telegram notifier with 429 retry

**Files:**
- Create: `src/services/telegram.ts`
- Test: `tests/services/telegram.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Sends message to Bot API endpoint.
- On `429` with `retry_after`, waits then retries once.
- Throws on second failure.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/services/telegram.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- `TelegramClient.send(message)` using global `fetch`.
- Parse retry delay from response JSON/header.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/services/telegram.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/services/telegram.ts tests/services/telegram.test.ts
git commit -m "feat: add telegram notifier with 429 retry"
```

### Task 6: Implement purchase history persistence

**Files:**
- Create: `src/services/purchaseHistory.ts`
- Test: `tests/services/purchaseHistory.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Appends JSONL record.
- Preserves previous records.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/services/purchaseHistory.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Append newline-delimited JSON to `data/purchase-history.jsonl`.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/services/purchaseHistory.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/services/purchaseHistory.ts tests/services/purchaseHistory.test.ts
git commit -m "feat: persist lotto purchase history as jsonl"
```

### Task 7: Implement lottery text parsers and guard logic

**Files:**
- Create: `src/lottery/parsers.ts`
- Test: `tests/lottery/parsers.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Parse currency text (`12,000원` -> `12000`).
- Detect captcha/additional-auth keywords.
- Extract draw+number lines from history-like text blocks.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/lottery/parsers.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Utility parsing functions and regex extraction.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/lottery/parsers.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lottery/parsers.ts tests/lottery/parsers.test.ts
git commit -m "feat: add lottery parsing utilities"
```

### Task 8: Implement Playwright lottery client

**Files:**
- Create: `src/lottery/client.ts`
- Create: `src/lottery/selectors.ts`
- Test: `tests/lottery/client-logic.test.ts`

**Step 1: Write the failing test**
Test requirements:
- Required purchase amount computed from game count.
- Insufficient balance throws `Err01` and blocks purchase.
- Step notifier emits section progress titles.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/lottery/client-logic.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Launch headless browser.
- Open site / login / deposit check / purchase / scrape numbers / logout / close.
- Throw typed errors (`Err01`, `Err02`, `Err03`, `Err04`, `Err05`, `Err06`, `Err07`, `Err08`).
- Keep selectors centralized and overrideable by env JSON.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/lottery/client-logic.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lottery/client.ts src/lottery/selectors.ts tests/lottery/client-logic.test.ts
git commit -m "feat: implement playwright run-once lottery automation"
```

### Task 9: Wire run-once entrypoint

**Files:**
- Create: `src/index.ts`
- Test: `tests/index/orchestration.test.ts`

**Step 1: Write the failing test**
Test requirements:
- On success: sends all progress messages and exits with code 0.
- On app error: sends error message and exits with mapped code.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/index/orchestration.test.ts --run`
Expected: FAIL.

**Step 3: Write minimal implementation**
- Initialize config/logger/telegram/history/client.
- Execute run-once orchestration.
- Map errors to exit code.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/index/orchestration.test.ts --run`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/index.ts tests/index/orchestration.test.ts
git commit -m "feat: add run-once orchestration entrypoint"
```

### Task 10: Verification and usage docs

**Files:**
- Create: `README.md`

**Step 1: Run full verification suite**
Run:
```bash
npm run build
npm test -- --run
```
Expected: build and tests pass.

**Step 2: Document execution**
- Install deps and Playwright browser.
- Configure `.env`.
- Run once via `npm run run-once` or `node dist/index.js`.
- Document error codes and retry intent for `Err01`.

**Step 3: Commit**
```bash
git add README.md
git commit -m "docs: add ubuntu run-once setup and operation guide"
```

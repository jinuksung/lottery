# Lottery Run-Once (TypeScript)

동행복권(`https://www.dhlottery.co.kr`)에서 로또 6/45를 **1회 실행(run-once)** 으로 자동 구매하는 Node.js/TypeScript 프로그램입니다.

## Scope

- 포함: 브라우저 실행 -> 접속 -> 로그인 -> 예치금 확인 -> 구매 -> 번호 저장 -> 로그아웃 -> 종료
- 포함: 단계별 텔레그램 알림, 오류 코드 기반 종료
- 제외: 크론, PM2, systemd, OpenClaw 자동화, 상시 데몬

## Requirements

- Node.js 20+
- Ubuntu 서버에서 Playwright Chromium 실행 가능 환경

## Install

```bash
npm install
npx playwright install chromium
```

## Environment

`.env.example`을 복사해서 `.env` 생성:

```bash
cp .env.example .env
chmod 600 .env
```

필수 값:

- `DHL_ID`
- `DHL_PASSWORD`
- `LOTTO_GAME_COUNT` (양의 정수, 자동번호 게임 수)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

기본/선택 값:

- `BROWSER_HEADLESS=true` (권장)
- `DHL_BASE_URL=https://www.dhlottery.co.kr`
- `DHL_SELECTORS_JSON` (사이트 구조 변경 시 셀렉터 오버라이드 JSON)

## Run Once

```bash
npm run run-once
```

또는:

```bash
npm run build
node dist/index.js
```

## Verified Runtime Flow

실제 동작 기준 구매 흐름은 아래와 같습니다.

1. `/login` 접속
2. visible 로그인 필드 `#inpUserId`, `#inpUserPswdEncn` 입력
3. 로그인 후 `/mypage/home` 이동
4. `구매가능` 금액 `#divCrntEntrsAmt` 기준으로 예치금 확인
5. 마이페이지에서 사이트 함수 `gmUtil.goGameClsf('LO40', 'PRCHS')`로 로또 팝업 열기
6. 팝업 내부 iframe `https://ol.dhlottery.co.kr/olotto/game/game645.do` 진입
7. `자동번호발급` 선택
8. `적용수량` 선택
9. 선택 확인 `#btnSelectNum`
10. `구매하기`
11. 최종 확인 레이어 `구매하시겠습니까?`에서 한 번 더 확인
12. 구매 결과 레이어 `#report`에서 회차/번호 추출
13. `data/purchase-history.jsonl` 저장
14. 로그아웃 후 종료

중요:

- 번호는 `구매하기` 직전이 아니라 **실제 구매 완료 후** 생성됩니다.
- 성공 번호 추출은 구매내역 페이지 fallback 이전에 **팝업 결과 레이어 `#report`** 를 우선 사용합니다.

## Telegram Notifications

진행 단계 메시지 포맷:

- `로또 구매를 진행 중입니다 (1/5) - 사이트 접속을 완료했습니다.`
- `로또 구매를 진행 중입니다 (2/5) - 로그인을 완료했습니다.`
- ...

429 대응:

- Telegram API가 `429`를 반환하면 `retry_after`(또는 `Retry-After` 헤더)만큼 대기 후 **1회 재시도**

## Files

- 로그 파일: `logs/run-once.log`
- 구매내역 파일(JSONL): `data/purchase-history.jsonl`
- 실사이트 디버그 산출물(필요 시): `logs/debug-*.html`, `logs/debug-*.png`

JSONL 레코드 예시:

```json
{"purchasedAt":"2026-02-27T12:00:00.000Z","drawNo":1171,"gameCount":2,"numbers":[[1,2,3,4,5,6],[11,12,13,14,15,16]]}
```

## Operations Runbook

실행 전 체크:

1. `.env` 확인
2. `LOTTO_GAME_COUNT` 확인
3. Playwright 브라우저 설치 확인

```bash
npx playwright install chromium
```

실행:

```bash
npm run run-once
```

성공 판정:

- `logs/run-once.log` 마지막에 아래 흐름이 있어야 합니다.
  - `예치금 확인`
  - `구매 번호 수집 완료`
  - `run-once 구매 프로세스 완료`
- `data/purchase-history.jsonl`에 1줄이 추가되어야 합니다.

성공 로그 예시:

```text
[INFO] 예치금 확인 {"availableDeposit":6000,"requiredDeposit":1000}
[INFO] 구매 번호 수집 완료 {"drawNo":1214,"games":1,"numbers":[[10,14,22,27,30,32]]}
[INFO] run-once 구매 프로세스 완료 {"drawNo":1214,"gameCount":1,"historyPath":".../data/purchase-history.jsonl"}
```

구매 수량을 1게임으로만 한 번 실행하려면:

```bash
LOTTO_GAME_COUNT=1 npm run run-once
```

실행 후 확인:

```bash
tail -n 30 logs/run-once.log
tail -n 3 data/purchase-history.jsonl
```

## Error Codes / Exit Codes

- `Err01` (`exit 11`): 예치금 부족 (전량 구매 불가 시 구매 중단)
- `Err02` (`exit 12`): 아이디/비밀번호 불일치
- `Err03` (`exit 13`): 캡차/OTP/추가 인증 필요
- `Err04` (`exit 14`): 로그인 상태 확인 실패(타임아웃)
- `Err05` (`exit 15`): 페이지 이동/셀렉터 탐색 실패
- `Err06` (`exit 16`): 구매 액션 실패
- `Err07` (`exit 17`): 구매번호 조회 실패(완료 화면 + 구매내역 재조회 실패)
- `Err08` (`exit 18`): 기타 예외
- Unknown (`exit 1`): 비정상 처리

실무적으로 자주 보는 실패 의미:

- `Err01`: 예치금 부족. 구매 자체를 시도하지 않음
- `Err03`: 캡차/OTP/휴대폰 인증이 나와 자동 진행 불가
- `Err06`: 구매 팝업 내부 selector 변경 가능성 높음
- `Err07`: 구매 완료 레이어 또는 구매내역 추출 구조 변경 가능성 높음

문제 분석 1순위 파일:

```bash
tail -n 50 logs/run-once.log
```

구조 확인이 필요하면:

- `logs/debug-login.html`
- `logs/debug-game645-frame.html`
- `logs/debug-ledger-via-link.html`

## Security Notes

- 아이디/비밀번호는 `.env`에서만 읽고 로그에 남기지 않습니다.
- `.env`는 Git에 커밋하지 않고(`.gitignore`), 파일 권한 `600`을 권장합니다.

## Test

```bash
npm test -- --run
```

## Maintenance Notes

사이트 구조가 다시 바뀌면 우선 아래 3개를 확인합니다.

1. 로그인 visible 필드가 그대로 `#inpUserId`, `#inpUserPswdEncn` 인지
2. 로또 팝업 iframe URL이 여전히 `/game645.do` 인지
3. 구매 완료 결과가 여전히 `#report`, `#reportRow`에 그려지는지

셀렉터 임시 우회가 필요하면 `.env`의 `DHL_SELECTORS_JSON`을 사용합니다.

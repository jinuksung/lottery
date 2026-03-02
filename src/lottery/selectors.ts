export interface SelectorGroups {
  loginButton: string[];
  loginIdInput: string[];
  loginPasswordInput: string[];
  loginSubmitButton: string[];
  loggedInIndicator: string[];
  logoutButton: string[];
  depositText: string[];
  lotto645BuyEntry: string[];
  autoSelectTab: string[];
  gameCountSelect: string[];
  gameCountInput: string[];
  selectionConfirmButton: string[];
  purchaseButton: string[];
  purchaseConfirmButton: string[];
  purchaseResultArea: string[];
  purchaseHistoryLink: string[];
  purchaseHistoryArea: string[];
}

export const DEFAULT_SELECTORS: SelectorGroups = {
  loginButton: [
    "a.h-right-a[href='/login']",
    "#loginBtn",
    "a[href*='login']",
    "text=로그인",
    "text=Login"
  ],
  loginIdInput: [
    "input#inpUserId",
    "input[name='inpUserId']",
    "input.login-id",
    "input[placeholder='아이디']",
    "input[name='userId']",
    "input#userId",
    "input[name='memId']",
    "input[placeholder*='아이디']"
  ],
  loginPasswordInput: [
    "input#inpUserPswdEncn",
    "input.login-pw",
    "input[placeholder='비밀번호']",
    "input[name='password']",
    "input[name='userPw']",
    "input#password",
    "input[type='password']"
  ],
  loginSubmitButton: [
    "button#btnLogin",
    "button.login-btn",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('로그인')",
    "a:has-text('로그인')"
  ],
  loggedInIndicator: [
    "text=로그아웃",
    "a:has-text('로그아웃')",
    "a[href*='logout']",
    "text=마이페이지"
  ],
  logoutButton: [
    "a.h-right-a[href='/securityLogout.do']",
    "#logoutBtn",
    "a[href*='logout']",
    "a:has-text('로그아웃')",
    "text=로그아웃"
  ],
  depositText: [
    "#divCrntEntrsAmt",
    "#totalAmt",
    "#tooltipTotalAmt",
    ".deposit-num#totalAmt",
    ".pssbl-num#divCrntEntrsAmt",
    "text=예치금",
    ".mydep",
    ".deposit",
    ".money"
  ],
  lotto645BuyEntry: [
    "#lt645ImdtPrchs .btn-buying1",
    "#lt645ImdtPrchs",
    ".lottery-tit-box#lt645ImdtPrchs",
    "button#lt645ImdtPrchs",
    "a[href*='buyLotto']",
    "a:has-text('로또 6/45')",
    "a:has-text('로또6/45')",
    "text=로또 6/45"
  ],
  autoSelectTab: [
    "a#num2",
    "label:has-text('자동번호')",
    "text=자동번호",
    "input[value='2']"
  ],
  gameCountSelect: [
    "select#amoundApply",
    "select[name='amoundApply']",
    "select[name='gameCount']",
    "select[name='']"
  ],
  gameCountInput: [
    "input[name='amoundApply']",
    "input[name='gameCount']",
    "input#amoundApply"
  ],
  selectionConfirmButton: [
    "input#btnSelectNum",
    "input[name='btnSelectNum']",
    "input[value='확인']"
  ],
  purchaseButton: [
    "button#btnBuy",
    "a:has-text('구매하기')",
    "button:has-text('구매하기')",
    "input[value*='구매하기']",
    "text=구매하기"
  ],
  purchaseConfirmButton: [
    "#popupLayerConfirm input[value='확인']",
    "input[onclick*='closepopupLayerConfirm(true)']",
    "#popupLayerConfirm .button.confirm",
    "button:has-text('확인')",
    "a:has-text('확인')",
    "text=확인"
  ],
  purchaseResultArea: [
    "#report",
    "#reportRow",
    ".tbl_data",
    ".result",
    ".lotto_num",
    "body"
  ],
  purchaseHistoryLink: [
    "a[href='/mypage/mylotteryledger']",
    "a:has-text('구매내역')",
    "a[href*='buyList']",
    "text=구매내역"
  ],
  purchaseHistoryArea: [
    ".tbl_data",
    ".board_list",
    "body"
  ]
};

export const mergeSelectorOverrides = (
  override: Record<string, string> | undefined
): SelectorGroups => {
  if (!override) {
    return DEFAULT_SELECTORS;
  }

  const merged: SelectorGroups = { ...DEFAULT_SELECTORS };
  for (const [key, selector] of Object.entries(override)) {
    if (!(key in merged)) {
      continue;
    }

    const typedKey = key as keyof SelectorGroups;
    merged[typedKey] = [selector, ...DEFAULT_SELECTORS[typedKey]];
  }

  return merged;
};

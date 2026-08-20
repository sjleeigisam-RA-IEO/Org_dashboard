(function () {
  const AUTH_TOKEN_KEY = "ra_auth_token";
  const USER_KEY = "ra_user";
  const LAST_ACTIVE_KEY = "last_active";
  const AUTH_ENDPOINT = "https://qvegpozwrcmspdvjokiz.functions.supabase.co/ra-auth";

  boot();

  async function boot() {
    const valid = await ensureSession();
    if (!valid) return;
    bindActivityTracking();
    bindShortcutNotice();
  }

  async function ensureSession() {
    if (hasActiveSession()) return true;

    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      try {
        const data = await authRequest("resume-session", { session_token: token });
        sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
        sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
        return true;
      } catch {
        clearAuth();
      }
    }

    redirectToLogin();
    return false;
  }

  function hasActiveSession() {
    const user = sessionStorage.getItem(USER_KEY);
    return Boolean(user);
  }

  function bindActivityTracking() {
    const updateSession = () => {
      sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    };
    ["mousedown", "keydown", "scroll", "touchstart"].forEach(name => {
      document.addEventListener(name, updateSession, true);
    });
  }

  function bindShortcutNotice() {
    const blockedShortcuts = new Set(["i", "j", "c", "u"]);
    let noticeShown = false;

    function showNotice() {
      if (noticeShown) return;
      noticeShown = true;
      console.warn("보안 설정으로 일부 기능을 제한합니다.");
      setTimeout(() => { noticeShown = false; }, 2000);
    }

    document.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showNotice();
    });

    document.addEventListener("keydown", (event) => {
      const key = String(event.key || "").toLowerCase();
      const isF12 = event.key === "F12" || event.keyCode === 123;
      const isBlockedCombo = event.ctrlKey && event.shiftKey && blockedShortcuts.has(key);
      const isViewSource = event.ctrlKey && !event.shiftKey && key === "u";

      if (!isF12 && !isBlockedCombo && !isViewSource) return;
      event.preventDefault();
      event.stopPropagation();
      showNotice();
    });
  }

  async function authRequest(mode, payload = {}) {
    const response = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Auth failed");
    return data;
  }

  function clearAuth() {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_ACTIVE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function redirectToLogin() {
    let rootPath = "";
    const pathname = decodeURIComponent(window.location.pathname);
    if (pathname.includes("/02. T5T Board/input-form/")) rootPath = "../../";
    else if (pathname.includes("01. RA Portal")) rootPath = "../../";
    else if (
      ["02. T5T Board", "03. Construction Board", "04. RentMap", "05. Org Board", "08. Floor Stacking OCR"]
        .some(segment => pathname.includes(segment))
    ) {
      rootPath = "../";
    }

    const currentUrl = window.location.href;
    window.top.location.href = (rootPath || "./") + "index.html?redirect=" + encodeURIComponent(currentUrl);
  }
})();

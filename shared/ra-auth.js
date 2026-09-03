(function () {
  const AUTH_TOKEN_KEY = "ra_auth_token";
  const SESSION_TOKEN_KEY = "ra_session_token";
  const USER_KEY = "ra_user";
  const LAST_ACTIVE_KEY = "last_active";
  const ADMIN_EMAIL = "sjlee@igisam.com";

  function endpoint() {
    if (window.RA_AUTH_ENDPOINT) return window.RA_AUTH_ENDPOINT;
    const supabaseUrl = window.SUPABASE_URL || "https://qvegpozwrcmspdvjokiz.supabase.co";
    return supabaseUrl.replace(".supabase.co", ".functions.supabase.co") + "/ra-auth";
  }

  async function request(mode, payload = {}) {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "인증 요청을 처리하지 못했습니다.");
    }
    return data;
  }

  function getSessionUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function isAdminUser(user = getSessionUser()) {
    return String(user?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
  }

  function setSessionUser(user) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  }

  function saveSessionToken(token, remember = false) {
    if (!token) return;
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    if (remember) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function saveRememberToken(token) {
    saveSessionToken(token, true);
  }

  function getRememberToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  }

  function getSessionToken() {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || getRememberToken();
  }

  function clearLocal() {
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_ACTIVE_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function touch() {
    sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  }

  async function resumeRememberedSession() {
    const token = getSessionToken();
    if (!token) return null;
    try {
      const data = await request("resume-session", { session_token: token });
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      setSessionUser(data.user);
      return data.user;
    } catch (error) {
      clearLocal();
      return null;
    }
  }

  async function logout() {
    const token = getSessionToken();
    clearLocal();
    if (token) {
      try {
        await request("logout", { session_token: token });
      } catch {
        // Local logout should still complete if the network is unavailable.
      }
    }
  }

  window.RAAuth = {
    AUTH_TOKEN_KEY,
    SESSION_TOKEN_KEY,
    USER_KEY,
    LAST_ACTIVE_KEY,
    ADMIN_EMAIL,
    request,
    getSessionUser,
    isAdminUser,
    setSessionUser,
    saveSessionToken,
    saveRememberToken,
    getRememberToken,
    getSessionToken,
    clearLocal,
    touch,
    resumeRememberedSession,
    logout,
  };
})();

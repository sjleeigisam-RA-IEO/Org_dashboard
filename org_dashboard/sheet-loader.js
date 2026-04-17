(function () {
  const config = window.ORG_DASHBOARD_REMOTE || {};
  const CALLBACK_NAME = "__ORG_DASHBOARD_REMOTE_CALLBACK__";
  const localOrgData = window.ORG_DASHBOARD_DATA || null;
  const isLocalhost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  const REMOTE_CACHE_KEY = "org_dashboard_remote_payload_v1";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = isLocalhost ? (src + "?_t=" + Date.now()) : src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다. ${src}`));
      document.body.appendChild(script);
    });
  }

  function showError(message) {
    document.body.innerHTML = `
      <div style="padding:40px;font-family:'Segoe UI','Malgun Gothic',sans-serif;color:#1f2a37;">
        <h1 style="margin:0 0 12px;font-size:28px;">구글시트 연결 오류</h1>
        <p style="margin:0 0 8px;line-height:1.6;">${message}</p>
        <p style="margin:0;color:#667085;line-height:1.6;">
          sheet-linked.config.js 에서 webAppUrl, accessKey 값을 확인한 뒤 다시 시도해 주세요.
        </p>
      </div>
    `;
  }

  function setRuntimeStatus(mode, reason, payload) {
    window.ORG_DASHBOARD_RUNTIME_STATUS = {
      mode: String(mode || "").trim(),
      reason: String(reason || "").trim(),
      generatedAt: payload?.meta?.generatedAt || "",
    };
  }

  function isValidPayload(payload) {
    return !!(payload && Array.isArray(payload.sections));
  }

  function saveRemoteCache(payload) {
    if (!isValidPayload(payload)) return;
    try {
      localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(payload));
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function loadRemoteCache() {
    try {
      const raw = localStorage.getItem(REMOTE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isValidPayload(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function loadRemoteJsonp(url) {
    return new Promise((resolve, reject) => {
      const callbackName = CALLBACK_NAME;
      const script = document.createElement("script");
      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      };

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };

      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("원격 스크립트를 불러오지 못했습니다."));
      };
      document.body.appendChild(script);
    });
  }

  async function bootDashboard() {
    await loadScript("./app.js");
    await loadScript("./seat-layout.js");
  }

  async function usePayload(payload, mode, reason) {
    window.ORG_DASHBOARD_DATA = payload;
    window.ORG_DASHBOARD_SEAT_LAYOUT = payload?.seatLayout || window.ORG_DASHBOARD_SEAT_LAYOUT || null;
    setRuntimeStatus(mode, reason, payload);
    await bootDashboard();
  }

  async function loadCachedFallback(reason) {
    const cachedPayload = loadRemoteCache();
    if (!cachedPayload) return false;
    await usePayload(cachedPayload, "cache", reason);
    console.warn("[sheet-loader] Remote sheet load failed, using cached remote payload.", reason);
    return true;
  }

  async function loadLocalFallback(reason) {
    if (!localOrgData) return false;
    await usePayload(localOrgData, "static", reason);
    console.warn("[sheet-loader] Remote sheet load failed, using static fallback.", reason);
    return true;
  }

  async function loadRemoteData() {
    if (!config.webAppUrl) {
      const usedFallback = await loadLocalFallback("missing webAppUrl");
      if (!usedFallback) {
        showError("웹앱 URL이 비어 있습니다.");
      }
      return;
    }

    const url = new URL(config.webAppUrl);
    if (config.accessKey) {
      url.searchParams.set("key", config.accessKey);
    }
    const seatSheets = normalizeSeatSheets(config.seatSheets);
    if (seatSheets.length) {
      url.searchParams.set("seat_sheets", seatSheets.join(","));
    } else if (config.seatSheet) {
      url.searchParams.set("seat_sheet", config.seatSheet);
    }
    url.searchParams.set("callback", CALLBACK_NAME);
    url.searchParams.set("_t", Date.now());

    try {
      const timeoutMs = Number(config.timeoutMs) || 15000;
      const payload = await Promise.race([
        loadRemoteJsonp(url),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("데이터를 불러오는 시간이 초과했습니다.")), timeoutMs);
        }),
      ]);
      if (payload && payload.ok === false) {
        throw new Error(payload.error || "원격 데이터에 접근하지 못했습니다.");
      }
      if (!isValidPayload(payload)) {
        throw new Error("대시보드 데이터 형식이 올바르지 않습니다.");
      }

      saveRemoteCache(payload);
      await usePayload(payload, "remote", "live");
    } catch (error) {
      const usedFallback = (await loadCachedFallback(error.message)) || (await loadLocalFallback(error.message));
      if (!usedFallback) {
        showError(`데이터를 불러오지 못했습니다. ${error.message}`);
      }
    }
  }

  loadRemoteData();
})();
  function normalizeSeatSheets(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

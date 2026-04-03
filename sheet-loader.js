(function () {
  const config = window.ORG_DASHBOARD_REMOTE || {};
  const CALLBACK_NAME = "__ORG_DASHBOARD_REMOTE_CALLBACK__";
  const localOrgData = window.ORG_DASHBOARD_DATA || null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src + "?_t=" + Date.now();
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

  async function loadLocalFallback(reason) {
    if (!localOrgData) return false;
    window.ORG_DASHBOARD_DATA = localOrgData;
    window.ORG_DASHBOARD_SEAT_LAYOUT = window.ORG_DASHBOARD_SEAT_LAYOUT || null;
    await bootDashboard();
    console.warn("[sheet-loader] Remote sheet load failed, using local fallback.", reason);
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

    const timeout = setTimeout(() => {
      showError("데이터를 불러오는 시간이 초과했습니다.");
    }, config.timeoutMs || 15000);

    const url = new URL(config.webAppUrl);
    if (config.accessKey) {
      url.searchParams.set("key", config.accessKey);
    }
    url.searchParams.set("callback", CALLBACK_NAME);
    url.searchParams.set("_t", Date.now());

    try {
      const payload = await loadRemoteJsonp(url);
      if (payload && payload.ok === false) {
        throw new Error(payload.error || "원격 데이터에 접근하지 못했습니다.");
      }
      if (!payload || !payload.sections) {
        throw new Error("대시보드 데이터 형식이 올바르지 않습니다.");
      }

      window.ORG_DASHBOARD_DATA = payload;
      window.ORG_DASHBOARD_SEAT_LAYOUT = payload.seatLayout || null;
      await bootDashboard();
    } catch (error) {
      const usedFallback = await loadLocalFallback(error.message);
      if (!usedFallback) {
        showError(`데이터를 불러오지 못했습니다. ${error.message}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  loadRemoteData();
})();

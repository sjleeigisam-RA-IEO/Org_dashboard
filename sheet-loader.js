(function () {
  const config = window.ORG_DASHBOARD_REMOTE || {};

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

  async function loadRemoteData() {
    if (!config.webAppUrl) {
      showError("웹 앱 URL이 비어 있습니다.");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 15000);
    const url = new URL(config.webAppUrl);

    if (config.accessKey) {
      url.searchParams.set("key", config.accessKey);
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || !payload.sections) {
        throw new Error("대시보드 데이터 형식이 올바르지 않습니다.");
      }

      window.ORG_DASHBOARD_DATA = payload;

      const appScript = document.createElement("script");
      appScript.src = "./app.js";
      appScript.defer = true;
      document.body.appendChild(appScript);
    } catch (error) {
      showError(`데이터를 불러오지 못했습니다. ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  loadRemoteData();
})();

(function () {
  // 1. Localhost 환경에서는 보안 제약 해제 (개발 편의성)
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  
  // 2. 세션 체크 및 로그인 유도 로직
  const checkSession = () => {
    if (isLocal) return true; // 로컬은 패스

    let raUser = sessionStorage.getItem('ra_user');
    let lastActive = parseInt(sessionStorage.getItem('last_active') || '0');
    const TIMEOUT_LIMIT = 30 * 60 * 1000; // 30분

    // sessionStorage에 세션 정보가 없거나 유효하지 않고 localStorage에 정보가 있는 경우 동기화(SSO 복구)
    if (!raUser || !lastActive || (Date.now() - lastActive >= TIMEOUT_LIMIT)) {
      const localUser = localStorage.getItem('ra_user');
      const localLastActive = parseInt(localStorage.getItem('last_active') || '0');
      
      if (localUser && localLastActive && (Date.now() - localLastActive < TIMEOUT_LIMIT)) {
        sessionStorage.setItem('ra_user', localUser);
        sessionStorage.setItem('last_active', localLastActive.toString());
        raUser = localUser;
        lastActive = localLastActive;
      }
    }

    const isValid = raUser && lastActive && (Date.now() - lastActive < TIMEOUT_LIMIT);

    if (!isValid) {
      // 루트(Login Page) 경로 계산
      const depth = window.location.pathname.split('/').filter(Boolean).length;
      // 'RA dashboard' 폴더명을 기준으로 그 위까지 거슬러 올라감 (현재 구조: d:/Project/.../RA dashboard/...)
      // 단순하게 현재 위치에서 상위로 이동하는 상대 경로 생성
      let rootPath = "";
      if (window.location.pathname.includes("CRM_base")) rootPath = "../../";
      else if (window.location.pathname.includes("t5t-dashboard")) rootPath = "../";
      else if (window.location.pathname.includes("org_dashboard")) rootPath = "../";
      else if (window.location.pathname.includes("t5t-input")) rootPath = "../";
      
      alert("안전한 시스템 사용을 위해 로그인이 필요합니다. 로그인 페이지로 이동합니다.");
      
      // 로그인 페이지로 강제 이동 (현재 URL을 redirect 파라미터로 붙임)
      const currentUrl = window.location.href;
      window.top.location.href = (rootPath || "./") + "index.html?redirect=" + encodeURIComponent(currentUrl);
      return false;
    }
    return true;
  };

  // 초기 실행
  if (!checkSession()) return;

  // 활동 시 세션 연장
  const updateSession = () => {
    const now = Date.now();
    sessionStorage.setItem('last_active', now);
    localStorage.setItem('last_active', now.toString());
  };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(e => document.addEventListener(e, updateSession, true));

  // 3. 브라우저 보안 제어 (우클릭, 개발자도구 방지 등)
  const blockedShortcuts = new Set(["i", "j", "c", "u"]);
  let noticeShown = false;

  function showNotice() {
    if (noticeShown) return;
    noticeShown = true;
    console.warn("보안 설정으로 일부 기능이 제한됩니다.");
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
})();

(function () {
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  if (isLocal) return;

  const blockedShortcuts = new Set(["i", "j", "c", "u"]);
  let noticeShown = false;

  function showNotice() {
    if (noticeShown) return;
    noticeShown = true;
    window.setTimeout(() => {
      alert("보안 설정으로 일부 브라우저 기능이 제한됩니다.");
    }, 0);
  }

  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location.href;
    } catch (_error) {
      window.self.location = window.self.location.href;
    }
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

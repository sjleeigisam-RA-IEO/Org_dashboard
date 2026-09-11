(() => {
  'use strict';

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const codeInput = document.getElementById('code');
  const rememberInput = document.getElementById('remember-me');
  const toggleButton = document.getElementById('toggle-code');
  const submitButton = document.getElementById('submit-button');
  const submitLabel = document.getElementById('submit-label');
  const spinner = submitButton.querySelector('.spinner');
  const arrow = submitButton.querySelector('.button-arrow');
  const errorElement = document.getElementById('form-error');
  const statusElement = document.getElementById('form-status');
  let pending = false;

  function clearError() {
    errorElement.hidden = true;
    errorElement.textContent = '';
    emailInput.removeAttribute('aria-invalid');
    codeInput.removeAttribute('aria-invalid');
  }

  function showError(message, field) {
    errorElement.textContent = message;
    errorElement.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  function setPending(value) {
    pending = value;
    submitButton.disabled = value;
    emailInput.disabled = value;
    codeInput.disabled = value;
    rememberInput.disabled = value;
    toggleButton.disabled = value;
    form.setAttribute('aria-busy', String(value));
    submitLabel.textContent = value ? '접속 확인 중' : '로그인';
    spinner.hidden = !value;
    arrow.hidden = value;
  }

  toggleButton.addEventListener('click', () => {
    const visible = codeInput.type === 'password';
    codeInput.type = visible ? 'text' : 'password';
    toggleButton.textContent = visible ? '숨김' : '표시';
    toggleButton.setAttribute('aria-label', visible ? '배포코드 숨기기' : '배포코드 표시');
    toggleButton.setAttribute('aria-pressed', String(visible));
  });

  emailInput.addEventListener('input', clearError);
  codeInput.addEventListener('input', clearError);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    clearError();
    statusElement.textContent = '';
    const email = emailInput.value.trim().toLowerCase();
    const code = codeInput.value;
    emailInput.value = email;

    if (!email || !emailInput.validity.valid || !/^[^\s@]+@igisam\.com$/.test(email)) {
      showError('@igisam.com 회사메일을 입력해 주세요.', emailInput);
      return;
    }
    if (!code.trim()) {
      showError('배포코드를 입력해 주세요.', codeInput);
      return;
    }

    setPending(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, code, rememberMe: rememberInput.checked }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPending(false);
        const message = typeof result.message === 'string' && result.message.length <= 200
          ? result.message
          : '회사메일과 배포코드를 다시 확인해 주세요.';
        showError(message, codeInput);
        return;
      }
      statusElement.textContent = '대시보드로 이동합니다.';
      window.location.replace('/app');
    } catch (error) {
      setPending(false);
      showError(error.name === 'AbortError'
        ? '응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
        : '접속을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      window.clearTimeout(timeout);
    }
  });

  const sessionController = new AbortController();
  const sessionTimeout = window.setTimeout(() => sessionController.abort(), 10000);
  fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store', signal: sessionController.signal })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => {
      if (session && session.authenticated === true) window.location.replace('/app');
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(sessionTimeout));
})();

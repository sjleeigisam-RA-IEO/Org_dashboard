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
  const sendCodeButton = document.getElementById('send-code-button');
  const sendCodeStatus = document.getElementById('send-code-status');
  let pending = false;
  let sending = false;
  let sendCodeEnabled = false;
  let cooldownUntil = 0;
  let cooldownTimer;

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

  function updateControls() {
    const busy = pending || sending;
    const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    submitButton.disabled = busy;
    emailInput.disabled = busy;
    codeInput.disabled = busy;
    rememberInput.disabled = busy;
    toggleButton.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    submitLabel.textContent = pending ? '접속 확인 중' : '로그인';
    spinner.hidden = !pending;
    arrow.hidden = pending;
    sendCodeButton.disabled = !sendCodeEnabled || busy || cooldownSeconds > 0;
    sendCodeButton.setAttribute('aria-busy', String(sending));
    sendCodeButton.textContent = sending ? '보내는 중…' : cooldownSeconds > 0
      ? `${cooldownSeconds}초 후 재전송` : '배포코드 받기';
  }

  function setPending(value) {
    pending = value;
    updateControls();
  }

  function startCooldown(seconds) {
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0) return;
    cooldownUntil = Date.now() + Math.min(Math.ceil(duration), 86400) * 1000;
    window.clearInterval(cooldownTimer);
    updateControls();
    cooldownTimer = window.setInterval(() => {
      updateControls();
      if (Date.now() >= cooldownUntil) window.clearInterval(cooldownTimer);
    }, 1000);
  }

  function retryAfterSeconds(response) {
    const header = response.headers.get('Retry-After');
    if (!header) return 60;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    const retryDate = Date.parse(header);
    return Number.isFinite(retryDate) ? Math.max(1, Math.ceil((retryDate - Date.now()) / 1000)) : 60;
  }

  function validatedEmail() {
    const email = emailInput.value.trim().toLowerCase();
    emailInput.value = email;
    if (!email || !emailInput.validity.valid || !/^[^\s@]+@igisam\.com$/.test(email)) {
      showError('@igisam.com 회사메일을 입력해 주세요.', emailInput);
      return null;
    }
    return email;
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

  sendCodeButton.addEventListener('click', async () => {
    if (!sendCodeEnabled || pending || sending || Date.now() < cooldownUntil) return;
    clearError();
    const email = validatedEmail();
    if (!email) return;
    sending = true;
    updateControls();
    sendCodeStatus.hidden = false;
    sendCodeStatus.dataset.state = 'pending';
    sendCodeStatus.textContent = '배포코드를 메일로 보내고 있습니다.';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        sendCodeStatus.hidden = true;
        if (response.status === 429) startCooldown(retryAfterSeconds(response));
        const message = typeof result.message === 'string' && result.message.length <= 200
          ? result.message
          : '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
        showError(message);
        return;
      }
      sendCodeStatus.dataset.state = 'success';
      sendCodeStatus.textContent = `${email} 주소로 배포코드를 보냈습니다. 메일함을 확인해 주세요.`;
      startCooldown(result.retryAfter || 60);
    } catch (error) {
      sendCodeStatus.hidden = true;
      showError(error.name === 'AbortError'
        ? '메일 전송 확인이 지연되고 있습니다. 메일함을 확인한 뒤 다시 시도해 주세요.'
        : '메일 전송을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    } finally {
      window.clearTimeout(timeout);
      sending = false;
      updateControls();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || sending) return;
    clearError();
    statusElement.textContent = '';
    const email = validatedEmail();
    const code = codeInput.value;
    if (!email) return;
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

  const capabilityController = new AbortController();
  const capabilityTimeout = window.setTimeout(() => capabilityController.abort(), 10000);
  fetch('/api/send-code', { credentials: 'same-origin', cache: 'no-store', signal: capabilityController.signal })
    .then((response) => response.ok ? response.json() : null)
    .then((capability) => {
      if (capability && capability.enabled === true) {
        sendCodeEnabled = true;
        sendCodeButton.hidden = false;
        updateControls();
      }
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(capabilityTimeout));
})();

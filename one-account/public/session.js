'use strict';
const logoutForm = document.querySelector('form[action="/api/logout"]');
logoutForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = logoutForm.querySelector('button');
  button.disabled = true;
  button.textContent = '로그아웃 중';
  try {
    const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('LOGOUT_FAILED');
    window.location.replace('/');
  } catch {
    button.disabled = false;
    button.textContent = '로그아웃 재시도';
  }
});

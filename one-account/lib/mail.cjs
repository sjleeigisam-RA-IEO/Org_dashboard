'use strict';
const auth = require('./auth.cjs');
const SENDER = 'sjlee.igisam@gmail.com';
const SENDER_NAME = '기획추진센터';
const SITE = 'https://one-account-nine.vercel.app/';

function settings() {
  if (process.env.ONE_ACCOUNT_MAIL_ENABLED !== 'true') throw new Error('MAIL_DISABLED');
  const password = String(process.env.ONE_ACCOUNT_GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  const code = process.env.ONE_ACCOUNT_DELIVERY_CODE || '';
  if (!/^[a-z]{16}$/.test(password) || !code || !auth.validCode(code, auth.config().code)) {
    throw new Error('MAIL_NOT_CONFIGURED');
  }
  return { password, code };
}
function enabled() { try { settings(); return true; } catch { return false; } }
function escape(value) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function message(email, code) {
  const recipient = auth.emailAddress(email);
  if (!recipient) throw new Error('INVALID_RECIPIENT');
  return {
    from: { name: SENDER_NAME, address: SENDER },
    to: [{ address: recipient }],
    subject: '[One Account] 요청하신 배포코드 안내',
    text: `기획추진센터 One Account\n\n요청하신 공통 배포코드입니다.\n\n${code}\n\n접속 주소: ${SITE}\n아이디: 본인의 @igisam.com 회사메일\n\n로그인 화면에서 자동로그인(30일)을 선택할 수 있습니다.\n직접 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.\n배포코드는 사내에서만 사용해 주세요.`,
    html: `<div style="font-family:Arial,sans-serif;color:#18334e;max-width:520px;padding:28px"><p style="font-size:13px;color:#61768b">기획추진센터</p><h1 style="font-size:26px">One Account 배포코드</h1><p>요청하신 공통 배포코드를 보내드립니다.</p><p style="padding:20px;background:#eef3f8;border-radius:8px;font-family:monospace;font-size:23px;font-weight:bold">${escape(code)}</p><p><a href="${SITE}">One Account 접속하기</a></p><p>회사메일과 위 코드를 입력해 로그인해 주세요.<br>자동로그인 선택 시 해당 브라우저에서 30일간 유지됩니다.</p><p style="font-size:12px;color:#687b8c">직접 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.<br>배포코드는 사내에서만 사용해 주세요.</p></div>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
async function send(email) {
  const { password, code } = settings();
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: SENDER, pass: password },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000, dnsTimeout: 5000,
    logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
    tls: { minVersion: 'TLSv1.2' },
  });
  try {
    const result = await transport.sendMail(message(email, code));
    if (!result.accepted?.length || result.rejected?.length) throw new Error('MAIL_NOT_ACCEPTED');
  } finally { transport.close(); }
}
module.exports = { settings, enabled, message, send, SENDER, SENDER_NAME };

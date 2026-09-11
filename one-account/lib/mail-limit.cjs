'use strict';
const crypto = require('node:crypto');

// Best-effort limits per Vercel function instance. Gmail also enforces account-wide
// sending quotas. These counters are not a distributed quota or a delivery ledger.
function createLimiter() {
  const entries = new Map();
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  return function reserve(req, email, now = Date.now()) {
    for (const [key, entry] of entries) if (entry.until <= now) entries.delete(key);
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const rules = [
      ['cooldown:' + digest(email), 1, 60000],
      ['email:' + digest(email), 5, 3600000],
      ['ip:' + digest(ip), 25, 3600000],
      ['total', 100, 86400000],
    ];
    let wait = 0;
    for (const [key, limit] of rules) {
      const entry = entries.get(key);
      if (entry && entry.count >= limit) wait = Math.max(wait, entry.until - now);
    }
    if (wait) return Math.ceil(wait / 1000);
    if (entries.size > 4096) return 3600;
    // Reserve before awaiting SMTP so concurrent requests cannot double-send.
    for (const [key, , duration] of rules) {
      const entry = entries.get(key) || { count: 0, until: now + duration };
      entry.count += 1;
      entries.set(key, entry);
    }
    return 0;
  };
}
module.exports = { createLimiter };

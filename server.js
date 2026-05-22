const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const webpush = require('web-push');

/* ── Port ─────────────────────────────────────────────────
   Render injects PORT automatically. Falls back to 5000
   for local / Replit development.
───────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;

/* ── VAPID (Web Push) ─────────────────────────────────────
   Keys are set as environment variables on Render.
   If they are missing we skip push-notification setup
   so the server still starts cleanly.
───────────────────────────────────────────────────────── */
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL       = process.env.VAPID_EMAIL       || 'mailto:admin@meralakshya.app';

let pushEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
    console.log('Web Push: VAPID keys loaded — push notifications enabled.');
  } catch (err) {
    console.warn('Web Push: VAPID setup failed —', err.message);
  }
} else {
  console.warn('Web Push: VAPID keys not set. Push notifications disabled.');
}

/* ── Push subscriptions ───────────────────────────────── */
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];

if (fs.existsSync(SUBS_FILE)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    console.log(`Loaded ${subscriptions.length} push subscription(s).`);
  } catch (_) {
    console.warn('Could not parse subscriptions.json — starting fresh.');
  }
}

function saveSubs() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2)); }
  catch (err) { console.error('Could not save subscriptions:', err.message); }
}

/* ── MIME types ───────────────────────────────────────── */
const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.css':         'text/css',
  '.js':          'application/javascript',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.jpg':         'image/jpeg',
  '.jpeg':        'image/jpeg',
  '.png':         'image/png',
  '.webp':        'image/webp',
  '.txt':         'text/plain',
};

/* ── Daily reminder messages ──────────────────────────── */
const DAILY_MESSAGES = [
  { title: '🌅 सुप्रभात! पढ़ाई शुरू करें',    body: 'आज का लक्ष्य पूरा करें — Bihar Board 2027 करीब है!' },
  { title: '📚 क्या आपने आज पढ़ाई की?',       body: 'हर दिन का प्रयास आपको मंजिल के करीब लाता है।' },
  { title: '⏰ पढ़ाई का समय!',                 body: 'Pomodoro टाइमर शुरू करें और फोकस करें।' },
  { title: '🎯 लक्ष्य याद है?',               body: 'Bihar Board 2027 — आपका सपना, आपकी मेहनत।' },
  { title: '💡 आज क्या सीखेंगे?',             body: 'एक विषय चुनें और शुरू करें। छोटे कदम बड़े नतीजे देते हैं।' },
];

function sendDailyReminders() {
  if (!pushEnabled || subscriptions.length === 0) return;
  const msg     = DAILY_MESSAGES[Math.floor(Math.random() * DAILY_MESSAGES.length)];
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: '/' });
  const dead    = [];
  subscriptions.forEach((sub, i) => {
    webpush.sendNotification(sub, payload).catch(() => dead.push(i));
  });
  if (dead.length) {
    subscriptions = subscriptions.filter((_, i) => !dead.includes(i));
    saveSubs();
  }
}

function msUntilNextHour(targetHour) {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

/* Schedule daily 8 AM reminder */
setTimeout(() => {
  sendDailyReminders();
  setInterval(sendDailyReminders, 24 * 60 * 60 * 1000);
}, msUntilNextHour(8));

/* ── Helpers ──────────────────────────────────────────── */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end',  () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/* ── Server ───────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  /* CORS preflight */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST',
    });
    res.end();
    return;
  }

  /* ── Health check endpoint (for UptimeRobot / Render) ── */
  if (req.method === 'GET' && (urlPath === '/health' || urlPath === '/api/health')) {
    return json(res, 200, {
      status:   'ok',
      service:  'मेरा लक्ष्य — Bihar Board 2027',
      uptime:   Math.floor(process.uptime()),
      push:     pushEnabled,
      subs:     subscriptions.length,
      ts:       new Date().toISOString(),
    });
  }

  /* ── VAPID public key ──────────────────────────────── */
  if (req.method === 'GET' && urlPath === '/vapid-public-key') {
    return json(res, 200, { publicKey: VAPID_PUBLIC_KEY });
  }

  /* ── Subscribe ─────────────────────────────────────── */
  if (req.method === 'POST' && urlPath === '/subscribe') {
    if (!pushEnabled) return json(res, 503, { error: 'Push not configured on this server.' });
    try {
      const sub    = await parseBody(req);
      const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
      if (!exists) { subscriptions.push(sub); saveSubs(); }
      return json(res, 201, { ok: true });
    } catch (_) {
      return json(res, 400, { error: 'Bad request' });
    }
  }

  /* ── Unsubscribe ───────────────────────────────────── */
  if (req.method === 'POST' && urlPath === '/unsubscribe') {
    try {
      const { endpoint } = await parseBody(req);
      subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
      saveSubs();
      return json(res, 200, { ok: true });
    } catch (_) {
      return json(res, 400, { error: 'Bad request' });
    }
  }

  /* ── Static files ──────────────────────────────────── */
  let filePath = (urlPath === '/' || urlPath === '') ? '/index.html' : urlPath;
  filePath = path.join(__dirname, filePath);

  /* Security: block path traversal outside project root */
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const ct  = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type':  ct,
      'Cache-Control': ext === '.html'
        ? 'no-cache'
        : 'public, max-age=86400',
    });
    res.end(data);
  });
});

/* ── Graceful shutdown ────────────────────────────────── */
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully…');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`  Health check: http://0.0.0.0:${PORT}/health`);
});

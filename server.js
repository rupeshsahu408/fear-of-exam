const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const webpush = require('web-push');

const PORT = 5000;

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = process.env.VAPID_EMAIL || 'mailto:admin@meralakshya.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];

if (fs.existsSync(SUBS_FILE)) {
  try { subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch (_) {}
}

function saveSubs() {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
}

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
};

const DAILY_MESSAGES = [
  { title: '🌅 सुप्रभात! पढ़ाई शुरू करें', body: 'आज का लक्ष्य पूरा करें — Bihar Board 2027 करीब है!' },
  { title: '📚 क्या आपने आज पढ़ाई की?', body: 'हर दिन का प्रयास आपको मंजिल के करीब लाता है।' },
  { title: '⏰ पढ़ाई का समय!', body: 'Pomodoro टाइमर शुरू करें और फोकस करें।' },
  { title: '🎯 लक्ष्य याद है?', body: 'Bihar Board 2027 — आपका सपना, आपकी मेहनत।' },
  { title: '💡 आज क्या सीखेंगे?', body: 'एक विषय चुनें और शुरू करें। छोटे कदम बड़े नतीजे देते हैं।' },
];

function sendDailyReminders() {
  if (subscriptions.length === 0) return;
  const msg = DAILY_MESSAGES[Math.floor(Math.random() * DAILY_MESSAGES.length)];
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: '/' });
  const dead = [];
  subscriptions.forEach((sub, i) => {
    webpush.sendNotification(sub, payload).catch(() => dead.push(i));
  });
  if (dead.length) {
    subscriptions = subscriptions.filter((_, i) => !dead.includes(i));
    saveSubs();
  }
}

function msUntilNextHour(targetHour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

setTimeout(() => {
  sendDailyReminders();
  setInterval(sendDailyReminders, 24 * 60 * 60 * 1000);
}, msUntilNextHour(8));

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' });
    res.end(); return;
  }

  if (req.method === 'GET' && urlPath === '/vapid-public-key') {
    return json(res, 200, { publicKey: VAPID_PUBLIC_KEY });
  }

  if (req.method === 'POST' && urlPath === '/subscribe') {
    try {
      const sub = await parseBody(req);
      const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
      if (!exists) { subscriptions.push(sub); saveSubs(); }
      return json(res, 201, { ok: true });
    } catch (_) {
      return json(res, 400, { error: 'Bad request' });
    }
  }

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

  let filePath = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const ct  = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

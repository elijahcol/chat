// ============================================================
//  SETTINGS — edit this to set your invite code
//  Only people who know this code can create an account.
//  You (the host) are the only one who sets it — friends just
//  type it in when they sign up, they can't pick their own.
// ============================================================
const INVITE_CODE = 'NWCC';
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.json');

// ---- Simple account store (username -> {salt, hash}) ----
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function createUser(username, password) {
  const users = loadUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = { salt, hash: hashPassword(password, salt) };
  saveUsers(users);
}
function verifyUser(username, password) {
  const users = loadUsers();
  const rec = users[username];
  if (!rec) return false;
  const hash = hashPassword(password, rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rec.hash, 'hex'));
}

// ---- Session tokens (token -> username), in-memory ----
const sessions = new Map();
function createToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, username);
  return token;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_ -]{2,24}$/.test(u.trim());
}

// ---- Static file server ----
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const server = http.createServer(async (req, res) => {
  // ---- API routes ----
  if (req.method === 'POST' && req.url === '/api/register') {
    try {
      const { username, password, inviteCode } = await readJsonBody(req);
      if ((inviteCode || '').toString() !== INVITE_CODE) {
        return sendJson(res, 403, { error: 'Wrong invite code' });
      }
      if (!isValidUsername(username)) {
        return sendJson(res, 400, { error: 'Username must be 2-24 chars: letters, numbers, spaces, - or _' });
      }
      if (typeof password !== 'string' || password.length < 4) {
        return sendJson(res, 400, { error: 'Password must be at least 4 characters' });
      }
      const name = username.trim();
      const users = loadUsers();
      if (users[name]) {
        return sendJson(res, 409, { error: 'That username is already taken' });
      }
      createUser(name, password);
      const token = createToken(name);
      return sendJson(res, 200, { token, username: name });
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid request' });
    }
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const { username, password } = await readJsonBody(req);
      const name = typeof username === 'string' ? username.trim() : '';
      if (!name || !verifyUser(name, password || '')) {
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      const token = createToken(name);
      return sendJson(res, 200, { token, username: name });
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid request' });
    }
  }

  // ---- Static file server ----
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- WebSocket chat logic ----
const wss = new WebSocket.Server({ server });

const clients = new Map(); // ws -> { username }
const HISTORY_LIMIT = 100;
let history = [];
const dmHistory = new Map(); // "userA|userB" (sorted) -> array of dm messages

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendToUser(username, msg) {
  const data = JSON.stringify(msg);
  for (const [sock, info] of clients.entries()) {
    if (info.username === username && sock.readyState === WebSocket.OPEN) {
      sock.send(data);
    }
  }
}

function dmKey(a, b) {
  return [a, b].sort().join('|');
}

function pushDm(a, b, msg) {
  const key = dmKey(a, b);
  if (!dmHistory.has(key)) dmHistory.set(key, []);
  const arr = dmHistory.get(key);
  arr.push(msg);
  if (arr.length > HISTORY_LIMIT) arr.shift();
}

function dmsForUser(username) {
  const result = {};
  for (const [key, arr] of dmHistory.entries()) {
    const [a, b] = key.split('|');
    if (a === username || b === username) {
      const other = a === username ? b : a;
      result[other] = arr;
    }
  }
  return result;
}

function userList() {
  return Array.from(clients.values()).map((c) => c.username);
}

function pushHistory(msg) {
  history.push(msg);
  if (history.length > HISTORY_LIMIT) history.shift();
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (data.type === 'join') {
      const token = (data.token || '').toString();
      const username = sessions.get(token);

      if (!username) {
        ws.send(JSON.stringify({ type: 'auth_error', text: 'Session expired, please log in again' }));
        ws.close();
        return;
      }

      // If this user is already connected elsewhere, that's fine — just track this socket too
      clients.set(ws, { username });

      // send history + user list to the new client
      ws.send(JSON.stringify({ type: 'welcome', username, history, users: userList(), dms: dmsForUser(username) }));

      const joinMsg = { type: 'system', text: `${username} joined the chat`, ts: Date.now() };
      pushHistory(joinMsg);
      broadcast(joinMsg);
      broadcast({ type: 'users', users: userList() });
      return;
    }

    if (data.type === 'message') {
      const client = clients.get(ws);
      if (!client) return;
      const text = (data.text || '').toString().slice(0, 2000);
      if (!text.trim()) return;
      const msg = { type: 'message', username: client.username, text, ts: Date.now() };
      pushHistory(msg);
      broadcast(msg);
      return;
    }

    if (data.type === 'private') {
      const client = clients.get(ws);
      if (!client) return;
      const to = (data.to || '').toString().trim();
      const text = (data.text || '').toString().slice(0, 2000);
      if (!text.trim() || !to || to === client.username) return;

      // recipient must be a real (registered) account, online or not
      const users = loadUsers();
      if (!users[to]) {
        ws.send(JSON.stringify({ type: 'dm_error', text: `No account named "${to}"` }));
        return;
      }

      const msg = { type: 'private', from: client.username, to, text, ts: Date.now() };
      pushDm(client.username, to, msg);
      sendToUser(client.username, msg); // echo to sender's own session(s)
      sendToUser(to, msg); // deliver to recipient if online
      return;
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      clients.delete(ws);
      const leaveMsg = { type: 'system', text: `${client.username} left the chat`, ts: Date.now() };
      pushHistory(leaveMsg);
      broadcast(leaveMsg);
      broadcast({ type: 'users', users: userList() });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  if (INVITE_CODE === 'letmein') {
    console.log('\n⚠️  Using the default invite code "letmein". Edit INVITE_CODE at the top of server.js to set your own!');
  }
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  console.log(`\nLAN Chat server running!`);
  console.log(`  Local:   http://localhost:${PORT}`);
  addresses.forEach((addr) => {
    console.log(`  Network: http://${addr}:${PORT}   <-- share this with friends on your LAN`);
  });
  console.log('');
});

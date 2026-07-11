import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbFile = path.join(dataDir, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';

fs.mkdirSync(dataDir, { recursive: true });

const loadDb = () => {
  if (!fs.existsSync(dbFile)) return { users: [], messages: [] };
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    return { users: [], messages: [] };
  }
};

let db = loadDb();
const saveDb = () => {
  const temp = `${dbFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, dbFile);
};

const publicUser = (user, presence = 'offline') => ({
  id: user.id,
  uin: user.uin,
  name: user.name,
  about: user.about || '',
  status: presence,
});

const makeUin = () => {
  let uin;
  do uin = String(10000000 + crypto.randomInt(90000000));
  while (db.users.some((user) => user.uin === uin));
  return uin;
};

if (db.users.length === 0) {
  const demoUsers = [
    { uin: '12345678', name: 'Аська', about: 'На связи с 2001 года' },
    { uin: '87654321', name: 'Старый друг', about: 'Верните мой 2007-й' },
  ];
  db.users = demoUsers.map((user) => ({
    ...user,
    id: crypto.randomUUID(),
    passwordHash: bcrypt.hashSync('icq2001', 10),
    contacts: [],
    createdAt: new Date().toISOString(),
  }));
  db.users[0].contacts = [db.users[1].id];
  db.users[1].contacts = [db.users[0].id];
  db.messages = [{
    id: crypto.randomUUID(),
    from: db.users[1].id,
    to: db.users[0].id,
    text: 'Привет! Ты тут? :)',
    kind: 'text',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    readAt: null,
  }];
  saveDb();
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: process.env.APP_ORIGIN ? { origin: process.env.APP_ORIGIN } : undefined,
});
const online = new Map();

app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

const issueToken = (user) => jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((entry) => entry.id === payload.sub);
    if (!user) throw new Error('Unknown user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Нужно войти в аккаунт' });
  }
};

const presenceFor = (id) => online.get(id)?.status || 'offline';
const emitPresence = (userId) => {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) return;
  const status = presenceFor(userId) === 'invisible' ? 'offline' : presenceFor(userId);
  user.contacts.forEach((contactId) => io.to(`user:${contactId}`).emit('presence', { userId, status }));
};

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'icq-retro' }));

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 32);
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Имя должно быть не короче 2 символов' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
  if (db.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Это имя уже занято' });
  }
  const user = {
    id: crypto.randomUUID(),
    uin: makeUin(),
    name,
    about: 'Я только что зарегистрировался!',
    passwordHash: await bcrypt.hash(password, 10),
    contacts: [],
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveDb();
  res.status(201).json({ token: issueToken(user), user: publicUser(user, 'online') });
});

app.post('/api/auth/login', async (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.users.find((entry) => entry.uin === login || entry.name.toLowerCase() === login);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Неверный UIN, имя или пароль' });
  }
  res.json({ token: issueToken(user), user: publicUser(user, 'online') });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user, presenceFor(req.user.id)) }));

app.patch('/api/me', auth, (req, res) => {
  if (typeof req.body.name === 'string') {
    const name = req.body.name.trim().slice(0, 32);
    if (name.length >= 2 && !db.users.some((u) => u.id !== req.user.id && u.name.toLowerCase() === name.toLowerCase())) {
      req.user.name = name;
    }
  }
  if (typeof req.body.about === 'string') req.user.about = req.body.about.trim().slice(0, 120);
  saveDb();
  res.json({ user: publicUser(req.user, presenceFor(req.user.id)) });
});

app.get('/api/contacts', auth, (req, res) => {
  const contacts = req.user.contacts
    .map((id) => db.users.find((entry) => entry.id === id))
    .filter(Boolean)
    .map((user) => ({
      ...publicUser(user, presenceFor(user.id) === 'invisible' ? 'offline' : presenceFor(user.id)),
      unread: db.messages.filter((m) => m.from === user.id && m.to === req.user.id && !m.readAt).length,
    }));
  res.json({ contacts });
});

app.get('/api/users/search', auth, (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  if (query.length < 2) return res.json({ users: [] });
  const users = db.users
    .filter((user) => user.id !== req.user.id && (user.name.toLowerCase().includes(query) || user.uin.includes(query)))
    .slice(0, 12)
    .map((user) => ({ ...publicUser(user, presenceFor(user.id)), isContact: req.user.contacts.includes(user.id) }));
  res.json({ users });
});

app.post('/api/contacts/:id', auth, (req, res) => {
  const contact = db.users.find((entry) => entry.id === req.params.id);
  if (!contact || contact.id === req.user.id) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!req.user.contacts.includes(contact.id)) req.user.contacts.push(contact.id);
  if (!contact.contacts.includes(req.user.id)) contact.contacts.push(req.user.id);
  saveDb();
  io.to(`user:${contact.id}`).emit('contacts:changed');
  res.status(201).json({ contact: publicUser(contact, presenceFor(contact.id)) });
});

app.get('/api/messages/:contactId', auth, (req, res) => {
  const contactId = req.params.contactId;
  if (!req.user.contacts.includes(contactId)) return res.status(403).json({ error: 'Сначала добавьте пользователя в контакты' });
  const messages = db.messages
    .filter((m) => (m.from === req.user.id && m.to === contactId) || (m.from === contactId && m.to === req.user.id))
    .slice(-250);
  let changed = false;
  messages.forEach((message) => {
    if (message.to === req.user.id && !message.readAt) {
      message.readAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) saveDb();
  io.to(`user:${contactId}`).emit('messages:read', { by: req.user.id });
  res.json({ messages });
});

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    const user = db.users.find((entry) => entry.id === payload.sub);
    if (!user) throw new Error('Unknown user');
    socket.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join(`user:${user.id}`);
  const current = online.get(user.id) || { sockets: new Set(), status: 'online' };
  current.sockets.add(socket.id);
  online.set(user.id, current);
  emitPresence(user.id);

  socket.on('status:set', (status) => {
    if (!['online', 'away', 'dnd', 'invisible'].includes(status)) return;
    const state = online.get(user.id);
    if (state) state.status = status;
    emitPresence(user.id);
  });

  socket.on('typing', ({ to, active }) => {
    if (user.contacts.includes(to)) io.to(`user:${to}`).emit('typing', { from: user.id, active: Boolean(active) });
  });

  socket.on('message:send', ({ to, text, kind = 'text' }, ack = () => {}) => {
    const contact = db.users.find((entry) => entry.id === to);
    const cleanText = String(text || '').trim().slice(0, 2000);
    const cleanKind = kind === 'nudge' ? 'nudge' : 'text';
    if (!contact || !user.contacts.includes(to) || (cleanKind === 'text' && !cleanText)) {
      return ack({ error: 'Сообщение не отправлено' });
    }
    const message = {
      id: crypto.randomUUID(),
      from: user.id,
      to,
      text: cleanKind === 'nudge' ? 'Встряска!' : cleanText,
      kind: cleanKind,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    db.messages.push(message);
    if (db.messages.length > 50000) db.messages = db.messages.slice(-40000);
    saveDb();
    io.to(`user:${to}`).emit('message:new', message);
    socket.emit('message:new', message);
    ack({ ok: true, message });
  });

  socket.on('disconnect', () => {
    const state = online.get(user.id);
    if (!state) return;
    state.sockets.delete(socket.id);
    if (state.sockets.size === 0) online.delete(user.id);
    emitPresence(user.id);
  });
});

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*splat', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ICQ Retro is running on http://localhost:${PORT}`);
});

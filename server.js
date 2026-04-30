require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');
const { launchBot, stopBot, getBotStatus } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _, next) => {
  if (req.url.startsWith('/api')) console.log(`[${req.method}] ${req.url}`);
  next();
});

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

function isValidMeetUrl(url) {
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(url);
}

// ===== AUTH =====

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });

    if (db.findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 10);
    db.createUser({ id, email, password: hash, name, created_at: new Date().toISOString() });

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, email, name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// ===== MEETINGS =====

app.post('/api/meetings', auth, (req, res) => {
  const { meetUrl, botName } = req.body;
  if (!meetUrl) return res.status(400).json({ error: 'Meeting URL required' });
  if (!isValidMeetUrl(meetUrl)) return res.status(400).json({ error: 'Invalid Google Meet URL. Format: https://meet.google.com/xxx-xxxx-xxx' });

  const id = crypto.randomUUID();
  const meeting = {
    id, meet_url: meetUrl, bot_name: botName || 'AI Scribe Bot',
    user_id: req.userId, status: 'bot_joining',
    created_at: new Date().toISOString(),
    ended_at: null, transcript: null, summary: null,
    key_points: null, action_items: null, duration: null
  };
  db.createMeeting(meeting);

  // Launch bot in background
  launchBot(id, meetUrl, botName || 'AI Scribe Bot', db);

  res.json({ meeting: formatMeeting(meeting) });
});

app.get('/api/meetings', auth, (req, res) => {
  const meetings = db.findMeetingsByUser(req.userId);
  res.json({ meetings: meetings.map(formatMeeting) });
});

app.get('/api/meetings/:id', auth, (req, res) => {
  const m = db.findMeetingById(req.params.id);
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json({ meeting: formatMeeting(m) });
});

app.get('/api/meetings/:id/status', auth, (req, res) => {
  const m = db.findMeetingById(req.params.id);
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  const bot = getBotStatus(m.id);
  res.json({ meetingId: m.id, status: m.status, captionCount: bot?.captionCount || 0, isConnected: bot?.isConnected || false });
});

app.post('/api/meetings/:id/stop', auth, (req, res) => {
  const m = db.findMeetingById(req.params.id);
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  stopBot(m.id);
  res.json({ message: 'Stop signal sent' });
});

app.delete('/api/meetings/:id', auth, (req, res) => {
  const m = db.findMeetingById(req.params.id);
  if (!m || m.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  stopBot(m.id);
  db.deleteMeeting(m.id);
  res.json({ message: 'Deleted' });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function formatMeeting(m) {
  return {
    id: m.id, meetUrl: m.meet_url, status: m.status, botName: m.bot_name,
    createdAt: m.created_at, endedAt: m.ended_at, summary: m.summary,
    keyPoints: m.key_points ? (typeof m.key_points === 'string' ? JSON.parse(m.key_points) : m.key_points) : [],
    actionItems: m.action_items ? (typeof m.action_items === 'string' ? JSON.parse(m.action_items) : m.action_items) : [],
    transcript: m.transcript ? (typeof m.transcript === 'string' ? JSON.parse(m.transcript) : m.transcript) : [],
    duration: m.duration
  };
}

app.listen(PORT, () => {
  console.log(`\n🚀 Meet Scribe running at http://localhost:${PORT}\n`);
});

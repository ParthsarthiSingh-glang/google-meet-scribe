const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('DB load error, starting fresh:', e.message);
  }
  return { users: [], meetings: [] };
}

function saveDB(d) {
  fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
}

let data = loadDB();

const db = {
  findUserByEmail(email) {
    return data.users.find(u => u.email === email) || null;
  },
  findUserById(id) {
    return data.users.find(u => u.id === id) || null;
  },
  createUser(user) {
    data.users.push(user);
    saveDB(data);
    return user;
  },
  createMeeting(meeting) {
    data.meetings.push(meeting);
    saveDB(data);
    return meeting;
  },
  findMeetingById(id) {
    return data.meetings.find(m => m.id === id) || null;
  },
  findMeetingsByUser(userId) {
    return data.meetings
      .filter(m => m.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },
  updateMeeting(id, updates) {
    const m = data.meetings.find(m => m.id === id);
    if (m) { Object.assign(m, updates); saveDB(data); }
    return m;
  },
  deleteMeeting(id) {
    data.meetings = data.meetings.filter(m => m.id !== id);
    saveDB(data);
  }
};

module.exports = db;

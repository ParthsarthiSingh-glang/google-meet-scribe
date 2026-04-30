# Google Meet AI Scribe — Simple Version

## No Docker needed! Just Node.js.

### Setup (3 steps)

**Step 1: Install Node.js** (if you don't have it)
- Download from https://nodejs.org (pick the LTS version)
- Install it, restart your terminal

**Step 2: Get a Gemini API key** (free)
- Go to https://aistudio.google.com/apikey
- Click "Create API Key"
- Copy the key

**Step 3: Run the app**
```powershell
cd google-meet-scribe-simple

# Install dependencies (first time only)
npm install

# Edit .env file - paste your Gemini API key
notepad .env

# Start the server
npm start
```

Open **http://localhost:3001** in your browser. That's it!

### How to use

1. **Sign up** with any email/password (stored locally)
2. **Create a Google Meet** in another tab
3. In Google Meet → **Host Controls** (bottom right) → **Quick Access → ON**
4. **Copy** the meeting link
5. **Paste** it in Meet Scribe and click **Deploy Bot**
6. The bot appears as **"AI Scribe Bot"** — admit it if needed
7. **Talk** in the meeting (captions must be on)
8. Click **Stop Bot** when done → get your AI summary!

### How it works

- **Puppeteer** launches a headless Chrome browser
- Chrome navigates to your Google Meet URL
- Bot enters its name, clicks "Ask to join"
- Once admitted, it presses 'c' to enable captions
- A MutationObserver scrapes caption text from the DOM
- When you stop the bot, the transcript goes to **Gemini AI** for summarization
- Summary, key points, and action items are saved to a local SQLite database

### Files

```
google-meet-scribe-simple/
├── server.js          # Express API server + serves frontend
├── bot.js             # Puppeteer bot (joins Meet, scrapes captions)
├── summarizer.js      # Gemini API summarization
├── database.js        # SQLite database (no external DB needed)
├── package.json       # Dependencies
├── .env               # Your API keys
├── public/
│   └── index.html     # Complete frontend (single file)
└── meetscribe.db      # Created automatically (SQLite)
```

### Deploying to the internet

The simplest way: rent a small VPS (like a $5/month DigitalOcean droplet or a free GCP VM), install Node.js, copy the project, and run it.

```bash
# On your server:
git clone <your-repo>
cd google-meet-scribe-simple
npm install
# Set up .env with your keys
npm start
```

For the frontend to be on a separate URL (like Netlify), just change the API calls in `public/index.html` from `/api` to `https://your-server-ip:3001/api`.

### Troubleshooting

- **Bot says "Failed"**: Make sure Quick Access is ON in Google Meet host controls
- **No captions captured**: Someone needs to be speaking. Captions must be available.
- **Puppeteer won't install**: On Windows, you might need to run PowerShell as Admin
- **Port 3001 in use**: Change PORT in .env file

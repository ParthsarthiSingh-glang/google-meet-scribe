const puppeteer = require('puppeteer');

// Store active bots
const activeBots = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchBot(meetingId, meetUrl, botName, db) {
  console.log(`\n[Bot] ========================================`);
  console.log(`[Bot] Launching bot for: ${meetUrl}`);
  console.log(`[Bot] Meeting ID: ${meetingId}`);
  console.log(`[Bot] ========================================\n`);

  const botState = {
    captions: [],
    isConnected: false,
    stopRequested: false,
    startTime: Date.now(),
    browser: null
  };
  activeBots.set(meetingId, botState);

  let browser;

  try {
    // Update status
    db.updateMeeting(meetingId, { status: 'bot_joining' });

    // Launch browser
    console.log('[Bot] Launching Chrome...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--mute-audio',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--window-size=1280,720'
      ]
    });
    botState.browser = browser;

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ===== NAVIGATE TO MEETING =====
    console.log('[Bot] Navigating to meeting...');
    await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    console.log('[Bot] Page loaded:', page.url());

    // ===== ENTER BOT NAME =====
    console.log('[Bot] Looking for name input...');
    await sleep(2000);

    // Try multiple selectors for the name input
    const nameSelectors = [
      'input[placeholder="Your name"]',
      'input[aria-label="Your name"]',
      'input[type="text"]'
    ];

    let nameEntered = false;
    for (const sel of nameSelectors) {
      try {
        const input = await page.$(sel);
        if (input) {
          const visible = await input.isIntersectingViewport().catch(() => true);
          if (visible) {
            await input.click({ clickCount: 3 });
            await sleep(200);
            await input.type(botName, { delay: 30 });
            console.log(`[Bot] Name entered: "${botName}" (via ${sel})`);
            nameEntered = true;
            break;
          }
        }
      } catch (e) {}
    }
    if (!nameEntered) console.log('[Bot] No name input found (may already be set)');

    // ===== TURN OFF MIC AND CAMERA =====
    await sleep(1000);
    for (const label of ['Turn off microphone', 'Turn off camera']) {
      try {
        const btn = await page.$(`button[aria-label*="${label}"]`);
        if (btn) { await btn.click(); console.log(`[Bot] Clicked: ${label}`); }
      } catch (e) {}
    }

    // ===== CLICK JOIN BUTTON =====
    console.log('[Bot] Looking for join button...');
    await sleep(1500);

    let joinClicked = false;

    // Method 1: Find by known selectors
    const joinSelectors = [
      'button[jsname="Qx7uuf"]',
      'button[aria-label="Ask to join"]',
      'button[aria-label="Join now"]',
      'button[aria-label="Join"]'
    ];

    for (const sel of joinSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          console.log(`[Bot] Clicked join button (${sel})`);
          joinClicked = true;
          break;
        }
      } catch (e) {}
    }

    // Method 2: Find by button text
    if (!joinClicked) {
      try {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => (el.textContent || '').trim().toLowerCase(), btn);
          if (text.includes('ask to join') || text.includes('join now') || text === 'join') {
            await btn.click();
            console.log(`[Bot] Clicked join button (text: "${text}")`);
            joinClicked = true;
            break;
          }
        }
      } catch (e) {}
    }

    // Method 3: Press Enter
    if (!joinClicked) {
      await page.keyboard.press('Enter');
      console.log('[Bot] Pressed Enter as join fallback');
      joinClicked = true;
    }

    // ===== WAIT TO BE ADMITTED =====
    console.log('[Bot] Waiting to be admitted...');
    let admitted = false;
    const joinStart = Date.now();
    const JOIN_TIMEOUT = 120000; // 2 minutes

    while (Date.now() - joinStart < JOIN_TIMEOUT) {
      if (botState.stopRequested) break;

      try {
        // Check if we're in the meeting
        const indicators = [
          'button[aria-label*="Leave call"]',
          'button[aria-label*="Leave meeting"]',
          'button[aria-label*="captions"]',
          'button[aria-label*="Turn on captions"]'
        ];

        for (const sel of indicators) {
          const el = await page.$(sel);
          if (el) {
            admitted = true;
            console.log(`[Bot] IN THE MEETING! (detected: ${sel})`);
            break;
          }
        }
        if (admitted) break;

        // Check page text
        const text = await page.evaluate(() => document.body.innerText?.substring(0, 3000) || '').catch(() => '');
        const lower = text.toLowerCase();

        if (lower.includes("you're the only one here") || lower.includes('joined') || lower.includes('meeting is ready')) {
          admitted = true;
          console.log('[Bot] IN THE MEETING! (detected via text)');
          break;
        }

        if (lower.includes("can't join") || lower.includes('meeting has ended') || lower.includes('not allowed')) {
          throw new Error('Meeting is not joinable — it may have ended or requires sign-in');
        }

        if (lower.includes('waiting') || lower.includes('asking to be let in')) {
          console.log('[Bot] Still waiting to be admitted...');
        }
      } catch (e) {
        if (e.message.includes('not joinable')) throw e;
      }

      await sleep(3000);
    }

    if (!admitted) {
      throw new Error('Could not join meeting within 2 minutes. Make sure to admit the bot or enable Quick Access in Host Controls.');
    }

    // ===== DISMISS OVERLAYS =====
    await sleep(2000);
    for (const text of ['Got it', 'Dismiss', 'Close', 'OK']) {
      try {
        const btns = await page.$$('button');
        for (const btn of btns) {
          const t = await page.evaluate(el => (el.textContent || '').trim(), btn);
          if (t === text) { await btn.click(); await sleep(300); break; }
        }
      } catch (e) {}
    }
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(200); }

    // ===== UPDATE STATUS TO LISTENING =====
    db.updateMeeting(meetingId, { status: 'listening' });
    botState.isConnected = true;
    console.log('\n[Bot] ✅ STATUS: LISTENING — Now capturing captions\n');

    // ===== ENABLE CAPTIONS =====
    await sleep(2000);

    // Method 1: Press 'c' key (Google Meet shortcut for captions)
    await page.keyboard.press('c');
    console.log('[Bot] Pressed "c" for captions');
    await sleep(2000);

    // Method 2: Click captions button
    for (const sel of ['button[aria-label*="Turn on captions"]', 'button[aria-label*="captions"]']) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); console.log(`[Bot] Clicked captions button`); break; }
      } catch (e) {}
    }

    await sleep(1000);

    // ===== SETUP CAPTION SCRAPING =====
    // Expose callback to receive captions from the page
    await page.exposeFunction('__onCaption', (speaker, text) => {
      if (!text || text.trim().length < 2) return;

      const caption = {
        speaker: speaker || 'Unknown',
        text: text.trim(),
        timestamp: new Date().toISOString()
      };

      botState.captions.push(caption);

      // Log every caption
      console.log(`[Caption] ${caption.speaker}: ${caption.text}`);
    });

    // Inject MutationObserver to watch captions in the DOM
    await page.evaluate(() => {
      const seen = new Map();
      const SPEAKER_SEL = '.zs7s8d, .YTbUzc, .NWpY1d, .xoMHSc';

      function getSpeaker(node) {
        if (!(node instanceof HTMLElement)) return 'Unknown';
        const badge = node.querySelector(SPEAKER_SEL);
        if (badge) return badge.textContent?.trim() || 'Unknown';
        let p = node.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          const b = p.querySelector(SPEAKER_SEL);
          if (b) return b.textContent?.trim() || 'Unknown';
          p = p.parentElement;
        }
        return 'Unknown';
      }

      function getText(node) {
        if (!(node instanceof HTMLElement)) return '';
        const clone = node.cloneNode(true);
        clone.querySelectorAll(SPEAKER_SEL).forEach(el => el.remove());
        return clone.textContent?.trim() || '';
      }

      function process(node) {
        if (!(node instanceof HTMLElement)) return;
        const text = getText(node);
        const speaker = getSpeaker(node);
        if (!text || text.length < 2) return;

        // Filter system messages
        const low = text.toLowerCase();
        if (low.includes('left the meeting') || low.includes('joined the meeting') ||
            low.includes('is presenting') || low.includes('recording') ||
            low.includes('you left') || low.includes('return to home') ||
            low.includes('feedback')) return;

        const lastText = seen.get(speaker);
        if (lastText === text) return;
        if (!lastText || text.length > lastText.length || !text.startsWith((lastText || '').substring(0, 15))) {
          seen.set(speaker, text);
          try { window.__onCaption(speaker, text); } catch(e) {}
        }
      }

      new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n instanceof HTMLElement) {
              process(n);
              n.querySelectorAll('*').forEach(c => process(c));
            }
          }
          if (m.type === 'characterData' && m.target?.parentElement) {
            process(m.target.parentElement);
          }
        }
      }).observe(document.body, { childList: true, characterData: true, subtree: true });

      console.log('[Bot] Caption observer active');
    });

    console.log('[Bot] Caption scraping started. Waiting for meeting to end...\n');

    // ===== WAIT FOR MEETING END =====
    const MAX_DURATION = 90 * 60 * 1000; // 90 min max
    const meetingStart = Date.now();

    while (true) {
      await sleep(5000);

      // Check stop requested
      if (botState.stopRequested) {
        console.log('[Bot] Stop requested by user');
        // Click leave button
        for (const sel of ['button[aria-label*="Leave call"]', 'button[aria-label*="Leave meeting"]']) {
          try {
            const btn = await page.$(sel);
            if (btn) { await btn.click(); break; }
          } catch (e) {}
        }
        await sleep(2000);
        break;
      }

      // Check max duration
      if (Date.now() - meetingStart > MAX_DURATION) {
        console.log('[Bot] Max duration reached');
        break;
      }

      // Check if meeting ended
      try {
        const text = await page.evaluate(() => document.body.innerText?.substring(0, 1000) || '').catch(() => '');
        const lower = text.toLowerCase();
        if (lower.includes('you left the meeting') || lower.includes('meeting has ended') ||
            lower.includes('return to home screen') || lower.includes("you've been removed")) {
          console.log('[Bot] Meeting has ended');
          break;
        }
      } catch (e) {
        console.log('[Bot] Page closed, ending');
        break;
      }

      // Check if still on meet
      try {
        const url = page.url();
        if (!url.includes('meet.google.com')) {
          console.log('[Bot] Redirected away from Meet');
          break;
        }
      } catch (e) { break; }
    }

    // ===== PROCESS RESULTS =====
    const captions = botState.captions;
    const duration = Math.floor((Date.now() - botState.startTime) / 1000);

    console.log(`\n[Bot] ========================================`);
    console.log(`[Bot] Meeting ended. Captured ${captions.length} caption segments.`);
    console.log(`[Bot] Duration: ${Math.floor(duration/60)}m ${duration%60}s`);
    console.log(`[Bot] ========================================\n`);

    // Save transcript
    db.updateMeeting(meetingId, { transcript: captions, status: 'processing', ended_at: new Date().toISOString(), duration });

    // Generate summary
    if (captions.length > 0) {
      try {
        const { summarize } = require('./summarizer');
        console.log('[Bot] Generating AI summary...');
        const result = await summarize(captions);
        db.updateMeeting(meetingId, { summary: result.summary, key_points: result.keyPoints, action_items: result.actionItems, status: 'completed' });
        console.log('[Bot] ✅ Summary generated and saved!');
      } catch (err) {
        console.error('[Bot] Summary failed:', err.message);
        db.updateMeeting(meetingId, { summary: 'Summary generation failed. Transcript is available.', status: 'completed' });
      }
    } else {
      db.updateMeeting(meetingId, { summary: 'No captions were captured. Make sure someone is speaking and captions are available.', status: 'completed' });
    }

  } catch (err) {
    console.error(`[Bot] ❌ ERROR: ${err.message}`);
    db.updateMeeting(meetingId, { status: 'failed', ended_at: new Date().toISOString() });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    activeBots.delete(meetingId);
    console.log('[Bot] Cleanup done.\n');
  }
}

function stopBot(meetingId) {
  const bot = activeBots.get(meetingId);
  if (bot) bot.stopRequested = true;
}

function getBotStatus(meetingId) {
  const bot = activeBots.get(meetingId);
  if (!bot) return null;
  return { captionCount: bot.captions.length, isConnected: bot.isConnected };
}

module.exports = { launchBot, stopBot, getBotStatus };

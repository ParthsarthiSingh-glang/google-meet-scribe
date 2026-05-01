const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const activeBots = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function debugScreenshot(page, label) {
  try {
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
    const filename = `${Date.now()}-${label}.png`;
    await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
    console.log(`[Bot] 📸 Screenshot saved: ${filename}`);
  } catch (e) {
    console.log(`[Bot] Screenshot failed: ${e.message}`);
  }
}

async function logPageInfo(page, label) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '').catch(() => '');
    console.log(`[Bot] --- ${label} ---`);
    console.log(`[Bot] URL: ${url}`);
    console.log(`[Bot] Title: ${title}`);
    console.log(`[Bot] Page text (first 500 chars): ${text.replace(/\n/g, ' | ')}`);
    console.log(`[Bot] ---`);
  } catch (e) {}
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
    db.updateMeeting(meetingId, { status: 'bot_joining' });

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
        '--window-size=1280,720',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    botState.browser = browser;

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Use a recent Chrome user agent
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // Hide automation signals
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // ===== STEP 1: NAVIGATE =====
    console.log('[Bot] Navigating to meeting...');
    await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(5000); // Wait longer for page to fully render

    await logPageInfo(page, 'After initial load');
    await debugScreenshot(page, 'page-loaded');

    // ===== CHECK: Are we on a sign-in page? =====
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.log('[Bot] ⚠️ Redirected to Google sign-in page. Meeting may require authentication.');
      console.log('[Bot] Trying to go back to meeting URL...');
      // Some meetings allow guest access even after redirect
      await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(5000);
      await logPageInfo(page, 'After retry navigation');
    }

    // ===== STEP 2: FIND AND FILL NAME =====
    console.log('[Bot] Looking for name input...');
    await sleep(3000);

    // Log all visible inputs for debugging
    const inputInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label'),
        visible: i.offsetParent !== null,
        value: i.value
      }));
    }).catch(() => []);
    console.log('[Bot] Found inputs:', JSON.stringify(inputInfo));

    // Log all buttons for debugging
    const buttonInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.filter(b => b.offsetParent !== null).map(b => ({
        text: (b.textContent || '').trim().substring(0, 40),
        ariaLabel: b.getAttribute('aria-label'),
        jsname: b.getAttribute('jsname')
      }));
    }).catch(() => []);
    console.log('[Bot] Found buttons:', JSON.stringify(buttonInfo));

    const nameSelectors = [
      'input[placeholder="Your name"]',
      'input[aria-label="Your name"]',
      'input[data-placeholder="Your name"]',
      'input[jsname="YPqjbf"]',
      'input[type="text"][aria-label]'
    ];

    let nameEntered = false;
    for (const sel of nameSelectors) {
      try {
        const input = await page.$(sel);
        if (input) {
          await input.click({ clickCount: 3 });
          await sleep(200);
          await input.type(botName, { delay: 30 });
          console.log(`[Bot] ✅ Name entered: "${botName}" (via ${sel})`);
          nameEntered = true;
          break;
        }
      } catch (e) {}
    }

    // Fallback: try any visible text input
    if (!nameEntered) {
      try {
        const inputs = await page.$$('input');
        for (const input of inputs) {
          const info = await page.evaluate(el => ({
            type: el.type, visible: el.offsetParent !== null,
            placeholder: el.placeholder
          }), input).catch(() => ({}));

          if (info.visible && (info.type === 'text' || info.type === '')) {
            await input.click({ clickCount: 3 });
            await sleep(200);
            await input.type(botName, { delay: 30 });
            console.log(`[Bot] ✅ Name entered via fallback input`);
            nameEntered = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!nameEntered) console.log('[Bot] ⚠️ No name input found');

    await debugScreenshot(page, 'after-name');

    // ===== STEP 3: TURN OFF MIC/CAMERA =====
    await sleep(1000);
    for (const label of ['Turn off microphone', 'Turn off camera', 'Mute', 'Camera']) {
      try {
        const btn = await page.$(`button[aria-label*="${label}"]`);
        if (btn) { await btn.click(); console.log(`[Bot] Clicked: ${label}`); await sleep(300); }
      } catch (e) {}
    }

    // ===== STEP 4: CLICK JOIN =====
    console.log('[Bot] Looking for join button...');
    await sleep(2000);

    let joinClicked = false;

    // Try known selectors
    const joinSelectors = [
      'button[jsname="Qx7uuf"]',
      'button[aria-label="Ask to join"]',
      'button[aria-label="Ask to join the meeting"]',
      'button[aria-label="Join now"]',
      'button[aria-label="Join"]',
      'button[data-idom-class*="join"]'
    ];

    for (const sel of joinSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await page.evaluate(el => el.offsetParent !== null, btn).catch(() => true);
          if (visible) {
            await btn.click();
            console.log(`[Bot] ✅ Clicked join button (${sel})`);
            joinClicked = true;
            break;
          }
        }
      } catch (e) {}
    }

    // Try by button text
    if (!joinClicked) {
      try {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => ({
            text: (el.textContent || '').trim().toLowerCase(),
            visible: el.offsetParent !== null
          }), btn).catch(() => ({ text: '', visible: false }));

          if (text.visible && (
            text.text.includes('ask to join') ||
            text.text.includes('join now') ||
            text.text === 'join' ||
            text.text.includes('request to join')
          )) {
            await btn.click();
            console.log(`[Bot] ✅ Clicked join button (text: "${text.text}")`);
            joinClicked = true;
            break;
          }
        }
      } catch (e) {}
    }

    if (!joinClicked) {
      // Try pressing Enter as last resort
      await page.keyboard.press('Enter');
      console.log('[Bot] ⚠️ Pressed Enter as join fallback');
    }

    await debugScreenshot(page, 'after-join-click');

    // ===== STEP 5: WAIT TO BE ADMITTED =====
    console.log('[Bot] Waiting to be admitted (up to 2 minutes)...');
    let admitted = false;
    const joinStart = Date.now();
    const JOIN_TIMEOUT = 120000;

    while (Date.now() - joinStart < JOIN_TIMEOUT) {
      if (botState.stopRequested) break;

      try {
        // Check for in-meeting indicators
        const indicators = [
          'button[aria-label*="Leave call"]',
          'button[aria-label*="Leave meeting"]',
          'button[aria-label*="Turn on captions"]',
          'button[aria-label*="Turn off captions"]',
          'button[aria-label*="CC"]',
          '[data-self-name]'
        ];

        for (const sel of indicators) {
          const el = await page.$(sel);
          if (el) {
            admitted = true;
            console.log(`[Bot] ✅ IN THE MEETING! (detected: ${sel})`);
            break;
          }
        }
        if (admitted) break;

        // Check page text — but be more careful about false positives
        const pageText = await page.evaluate(() => document.body.innerText?.substring(0, 3000) || '').catch(() => '');
        const lower = pageText.toLowerCase();

        // Positive signals that we're in the meeting
        if (lower.includes("you're the only one here") ||
            lower.includes('you are the only one here') ||
            lower.includes('meeting is ready') ||
            lower.includes('present now')) {
          admitted = true;
          console.log('[Bot] ✅ IN THE MEETING! (detected via text)');
          break;
        }

        // Negative signals — meeting is definitely not accessible
        // Be very specific to avoid false positives
        if (lower.includes("you can't join this meeting") ||
            lower.includes('this meeting has ended') ||
            lower.includes('check the meeting code') ||
            lower.includes('invalid meeting code') ||
            lower.includes('this video call has ended')) {
          await debugScreenshot(page, 'cannot-join');
          throw new Error('Meeting is not accessible — check if the meeting is still active and the link is correct');
        }

        // Waiting signals
        if (lower.includes('waiting for the host') ||
            lower.includes('asking to be let in') ||
            lower.includes('someone in the meeting') ||
            lower.includes('waiting to be let in')) {
          // Only log every 15 seconds
          if ((Date.now() - joinStart) % 15000 < 3000) {
            console.log('[Bot] ⏳ Waiting to be admitted by host...');
          }
        }

      } catch (e) {
        if (e.message.includes('not accessible')) throw e;
      }

      await sleep(3000);
    }

    if (!admitted) {
      await debugScreenshot(page, 'not-admitted');
      await logPageInfo(page, 'Not admitted - timeout');
      throw new Error('Could not join meeting within 2 minutes. Please admit the bot manually or enable Quick Access.');
    }

    // ===== STEP 6: WE'RE IN! =====
    await sleep(2000);

    // Dismiss overlays
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

    db.updateMeeting(meetingId, { status: 'listening' });
    botState.isConnected = true;
    console.log('\n[Bot] ✅ STATUS: LISTENING\n');

    await debugScreenshot(page, 'in-meeting');

    // ===== STEP 7: ENABLE CAPTIONS =====
    await sleep(3000);

    // Try keyboard shortcut 'c'
    await page.keyboard.press('c');
    console.log('[Bot] Pressed "c" for captions');
    await sleep(2000);

    // Try clicking captions button
    const captionSelectors = [
      'button[aria-label*="Turn on captions"]',
      'button[aria-label*="captions"]',
      'button[aria-label*="subtitle"]',
      'button[aria-label*="CC"]',
      'button[jsname="r8qRAd"]'
    ];
    for (const sel of captionSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); console.log(`[Bot] ✅ Clicked caption button: ${sel}`); break; }
      } catch (e) {}
    }

    await debugScreenshot(page, 'captions-enabled');

    // ===== STEP 8: SCRAPE CAPTIONS =====
    await page.exposeFunction('__onCaption', (speaker, text) => {
      if (!text || text.trim().length < 2) return;
      const caption = { speaker: speaker || 'Unknown', text: text.trim(), timestamp: new Date().toISOString() };
      botState.captions.push(caption);
      console.log(`[Caption] ${caption.speaker}: ${caption.text}`);
    });

    // Inject MutationObserver
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
            if (n instanceof HTMLElement) { process(n); n.querySelectorAll('*').forEach(c => process(c)); }
          }
          if (m.type === 'characterData' && m.target?.parentElement) process(m.target.parentElement);
        }
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
    });

    console.log('[Bot] Caption observer injected. Waiting for meeting to end...\n');

    // ===== STEP 9: WAIT FOR END =====
    const MAX_DURATION = 90 * 60 * 1000;
    while (true) {
      await sleep(5000);

      if (botState.stopRequested) {
        console.log('[Bot] Stop requested');
        for (const sel of ['button[aria-label*="Leave call"]', 'button[aria-label*="Leave meeting"]']) {
          try { const btn = await page.$(sel); if (btn) { await btn.click(); break; } } catch (e) {}
        }
        await sleep(2000);
        break;
      }

      if (Date.now() - botState.startTime > MAX_DURATION) { console.log('[Bot] Max duration'); break; }

      try {
        const text = await page.evaluate(() => document.body.innerText?.substring(0, 1000) || '').catch(() => '');
        const lower = text.toLowerCase();
        if (lower.includes('you left the meeting') || lower.includes('meeting has ended') ||
            lower.includes('return to home screen') || lower.includes("you've been removed")) {
          console.log('[Bot] Meeting ended'); break;
        }
      } catch (e) { break; }

      try { if (!page.url().includes('meet.google.com')) { console.log('[Bot] Redirected'); break; } } catch (e) { break; }
    }

    // ===== SAVE RESULTS =====
    const captions = botState.captions;
    const duration = Math.floor((Date.now() - botState.startTime) / 1000);

    console.log(`\n[Bot] Meeting ended. ${captions.length} captions. Duration: ${Math.floor(duration/60)}m ${duration%60}s\n`);

    db.updateMeeting(meetingId, { transcript: captions, status: 'processing', ended_at: new Date().toISOString(), duration });

    if (captions.length > 0) {
      try {
        const { summarize } = require('./summarizer');
        console.log('[Bot] Generating AI summary...');
        const result = await summarize(captions);
        db.updateMeeting(meetingId, { summary: result.summary, key_points: result.keyPoints, action_items: result.actionItems, status: 'completed' });
        console.log('[Bot] ✅ Summary saved!');
      } catch (err) {
        console.error('[Bot] Summary failed:', err.message);
        db.updateMeeting(meetingId, { summary: 'Summary generation failed. Transcript is available.', status: 'completed' });
      }
    } else {
      db.updateMeeting(meetingId, { summary: 'No captions were captured. Make sure someone is speaking and captions are enabled.', status: 'completed' });
    }

  } catch (err) {
    console.error(`[Bot] ❌ ERROR: ${err.message}`);
    db.updateMeeting(meetingId, { status: 'failed', ended_at: new Date().toISOString() });
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
    activeBots.delete(meetingId);
    console.log('[Bot] Done.\n');
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
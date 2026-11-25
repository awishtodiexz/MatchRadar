// Rebuilds the README banner and screenshots from the current build.
// Usage: npm run screenshots
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = join(root, 'docs', 'screenshots');
const brand = join(root, 'docs', 'brand');
const baseURL = 'http://127.0.0.1:1421';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (!existsSync(join(root, 'dist', 'index.html'))) {
  throw new Error('No production build found. Run `npm run build` first.');
}

const raw = JSON.parse(await readFile(join(root, 'tests', 'fixtures', 'summary-completed.json'), 'utf8'));
const teamName = { 359: 'Arsenal', 357: 'Leeds United' };
const participants = (event) => {
  if (event.participants?.length) return event.participants.map((player) => player.athlete.displayName);
  const substitution = event.text?.match(/Substitution, [^.]+\. (.+?) replaces (.+)\./);
  if (substitution) return [substitution[1], substitution[2]];
  const card = event.text?.match(/^(.+?) \([^)]+\) (?:is shown|has been)/);
  if (card) return [card[1]];
  const goal = event.text?.match(/^(?:Goal!|Penalty!)[^.]*\.\s*(.+?)\s*\([^)]+\)/);
  return goal ? [goal[1]] : [];
};
const events = raw.keyEvents.map((event) => ({
  id: event.id,
  minute: event.clock?.displayValue ?? '',
  period: event.period?.number ?? 0,
  seconds: event.clock?.value ?? 0,
  kind: event.type.type === 'end-regular-time' ? 'full-time' : event.type.type,
  text: event.text ?? event.type.text,
  teamId: event.team?.id ?? null,
  participants: participants(event),
  shortText: event.shortText ?? null,
}));
const statistics = raw.boxscore.teams.flatMap((team) =>
  team.statistics.map((stat) => ({
    teamId: team.team.id,
    name: stat.name,
    label: stat.label,
    value: stat.displayValue,
  })),
);
const players = raw.rosters.flatMap((team) =>
  team.roster.map((player) => ({
    teamId: team.team.id,
    name: player.athlete.displayName,
    position: player.position.abbreviation,
    starter: player.starter,
    jersey: player.jersey ?? null,
    formationPlace: player.formationPlace ?? null,
    subbedIn: player.subbedIn ?? false,
    subbedOut: player.subbedOut ?? false,
  })),
);
const substitutions = events
  .filter((event) => event.kind === 'substitution' && event.participants.length === 2)
  .map((event) => ({
    teamId: event.teamId,
    playerIn: event.participants[0],
    playerOut: event.participants[1],
    minute: event.minute,
  }));
const scorers = events
  .filter((event) => event.kind === 'goal')
  .map((event) => ({
    teamId: event.teamId,
    teamName: teamName[event.teamId] ?? '',
    name: event.participants[0] ?? 'Scorer unavailable',
    minute: event.minute,
    ownGoal: false,
    penalty: false,
  }));

const now = Date.now();
const iso = (offsetMinutes) => new Date(now + offsetMinutes * 60_000).toISOString();
const arsenal = { id: '359', name: 'Arsenal', short: 'ARS' };
const leeds = { id: '357', name: 'Leeds United', short: 'LEE' };
const baseSnapshot = {
  updatedAt: new Date(now).toISOString(),
  settings: {
    matchAlerts: {},
    favorites: ['359', '364'],
    followedOnly: false,
    compact: false,
    alwaysOnTop: true,
    startHidden: false,
    reducedMotion: true,
    singleKeyShortcuts: true,
    opacity: 96,
    theme: 'dark',
    competitionView: 'premierLeague',
    reminders: true,
    reminderMinutes: 15,
    starts: true,
    goals: false,
  },
  matches: [
    {
      id: 'live-city-liverpool',
      league: 'premierLeague',
      competition: 'Premier League',
      home: { id: '382', name: 'Manchester City', short: 'MCI' },
      away: { id: '364', name: 'Liverpool', short: 'LIV' },
      homeScore: 1,
      awayScore: 1,
      kickoff: iso(-67),
      status: 'live',
      detail: "67'",
    },
    {
      id: 'live-newcastle-spurs',
      league: 'premierLeague',
      competition: 'Premier League',
      home: { id: '361', name: 'Newcastle United', short: 'NEW' },
      away: { id: '367', name: 'Tottenham Hotspur', short: 'TOT' },
      homeScore: 0,
      awayScore: 2,
      kickoff: iso(-72),
      status: 'live',
      detail: "72'",
    },
    {
      id: '401879268',
      league: 'premierLeague',
      competition: 'Premier League',
      home: arsenal,
      away: leeds,
      homeScore: 2,
      awayScore: 1,
      kickoff: iso(-180),
      status: 'fulltime',
      detail: 'Full-time',
    },
    {
      id: 'next-villa-brighton',
      league: 'premierLeague',
      competition: 'Premier League',
      home: { id: '362', name: 'Aston Villa', short: 'AVL' },
      away: { id: '331', name: 'Brighton & Hove Albion', short: 'BHA' },
      kickoff: iso(150),
      status: 'scheduled',
      detail: 'Scheduled',
    },
  ],
};
const snapshotFor = (theme) => ({ ...baseSnapshot, settings: { ...baseSnapshot.settings, theme } });
const summary = {
  matchId: '401879268',
  matchState: 'post',
  updatedAt: new Date(now).toISOString(),
  stale: false,
  error: null,
  venue: null,
  events,
  statistics,
  players,
  substitutions,
  scorers,
  formations: {},
};

const installBridge = ({ snapshot, summary }) => {
  let state = snapshot;
  const internals = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command, args = {}) => {
      if (command === 'get_snapshot') return state;
      if (command === 'get_notification_target') return null;
      if (command === 'acknowledge_notification_target') return;
      if (command === 'save_settings') {
        state = { ...state, settings: args.settings };
        return state.settings;
      }
      if (command === 'get_recent_results') return { matches: [], updatedAt: state.updatedAt, error: null };
      if (command === 'get_match_details') return { ...summary, matchId: args.id };
      if (command === 'plugin:event|listen') return 1;
      if (command === 'plugin:event|unlisten') return;
      if (command === 'plugin:autostart|is_enabled') return false;
      return null;
    },
  };
  Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: internals });
};

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? undefined
          : new Promise((done) => {
              image.onload = image.onerror = done;
            }),
      ),
    );
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await sleep(300);
};

const crestCache = new Map();
const serveCrests = async (page) => {
  await page.route('https://a.espncdn.com/**', async (route) => {
    const url = route.request().url();
    try {
      if (!crestCache.has(url)) {
        const response = await fetch(url);
        crestCache.set(url, {
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'image/png',
          body: Buffer.from(await response.arrayBuffer()),
          ok: response.ok,
        });
      }
      const crest = crestCache.get(url);
      if (!crest.ok) return route.abort();
      await route.fulfill({ status: crest.status, contentType: crest.contentType, body: crest.body });
    } catch {
      await route.abort();
    }
  });
};

const openWidget = async (browser, theme) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 700 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: theme,
  });
  await serveCrests(page);
  await page.addInitScript(installBridge, { snapshot: snapshotFor(theme), summary });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await settle(page);
  return page;
};

const writeBanner = async (browser) => {
  const logo = (await readFile(join(root, 'src', 'assets', 'logo.png'))).toString('base64');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const page = await browser.newPage({
    viewport: { width: 1600, height: 560 },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  await page.setContent(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; background: transparent; }
  body { font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; }
  .banner {
    position: relative; width: 1600px; height: 560px; overflow: hidden;
    padding: 54px 72px; border: 1px solid rgba(160, 175, 183, .24); border-radius: 24px;
    background:
      radial-gradient(760px 500px at 10% 0%, rgba(177, 237, 80, .17), transparent 64%),
      radial-gradient(720px 560px at 100% 110%, rgba(177, 237, 80, .09), transparent 62%),
      linear-gradient(124deg, #0a1114 0%, #0b1418 46%, #091014 100%);
    color: #f0f4f5;
  }
  .banner::after {
    content: ""; position: absolute; inset: 0; border-radius: 24px; pointer-events: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .09), inset 0 0 120px rgba(0, 0, 0, .22);
  }
  .grid {
    position: absolute; inset: 0; opacity: .7;
    background-image:
      linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(circle at 82% 48%, #000 0%, transparent 72%);
    -webkit-mask-image: radial-gradient(circle at 82% 48%, #000 0%, transparent 72%);
  }
  .radar {
    position: absolute; width: 720px; height: 720px; right: -120px; top: 50%;
    transform: translateY(-50%); border-radius: 50%;
  }
  .ring {
    position: absolute; border: 1px solid rgba(177, 237, 80, .16); border-radius: 50%;
    box-shadow: 0 0 60px rgba(177, 237, 80, .025);
  }
  .ring.one { inset: 0; }
  .ring.two { inset: 106px; }
  .ring.three { inset: 212px; }
  .ring.four { inset: 318px; border-color: rgba(177, 237, 80, .28); }
  .sweep {
    position: absolute; inset: 0; border-radius: 50%;
    background: conic-gradient(from 205deg, transparent 0deg 76deg, rgba(177, 237, 80, .17) 92deg, transparent 112deg);
    filter: blur(1px);
  }
  .blip {
    position: absolute; width: 7px; height: 7px; border-radius: 50%; background: #b1ed50;
    box-shadow: 0 0 0 5px rgba(177, 237, 80, .09), 0 0 20px rgba(177, 237, 80, .7);
  }
  .blip.one { left: 27%; top: 30%; }
  .blip.two { left: 63%; top: 66%; width: 5px; height: 5px; opacity: .75; }
  .content { position: relative; z-index: 2; width: 970px; }
  .topline { display: flex; align-items: center; justify-content: space-between; font-size: 18px; letter-spacing: 2.4px; text-transform: uppercase; font-weight: 700; color: #a0afb7; }
  .eyebrow { display: inline-flex; align-items: center; gap: 10px; color: #b1ed50; }
  .eyebrow .dot { width: 7px; height: 7px; border-radius: 50%; background: #b1ed50; box-shadow: 0 0 12px rgba(177, 237, 80, .8); }
  .version { color: #8fa2aa; font-size: 16px; letter-spacing: 1.6px; text-transform: none; }
  .brand { display: flex; align-items: center; gap: 18px; margin-top: 24px; }
  .brand img { width: 68px; height: 68px; }
  .wordmark { font-size: 46px; line-height: 1; font-weight: 800; letter-spacing: -2.6px; }
  .wordmark span { color: #b1ed50; }
  .wordmark sup { position: relative; top: -17px; margin-left: 4px; font-size: 11px; letter-spacing: 0; color: #72858d; font-weight: 600; }
  h1 { margin: 30px 0 0; font-size: 66px; line-height: 1.01; letter-spacing: -3.6px; font-weight: 700; }
  h1 span { color: #b1ed50; }
  p { margin: 18px 0 0; max-width: 780px; color: #a0afb7; font-size: 20px; line-height: 1.5; letter-spacing: -.2px; }
  .chips { display: flex; gap: 9px; margin-top: 28px; }
  .chip { padding: 8px 16px; border: 1px solid rgba(160, 175, 183, .22); border-radius: 999px; background: rgba(255, 255, 255, .035); color: #c9d4d9; font-size: 17px; font-weight: 600; letter-spacing: .2px; }
</style>
</head>
<body>
  <div class="banner">
    <div class="grid"></div>
    <div class="radar" aria-hidden="true">
      <div class="sweep"></div>
      <div class="ring one"></div>
      <div class="ring two"></div>
      <div class="ring three"></div>
      <div class="ring four"></div>
      <div class="blip one"></div>
      <div class="blip two"></div>
    </div>
    <div class="content">
      <div class="topline">
        <span class="eyebrow"><i class="dot"></i>Windows desktop widget</span>
        <span class="version">v${version}</span>
      </div>
      <div class="brand">
        <img src="data:image/png;base64,${logo}" alt="">
        <div class="wordmark">match<span>radar</span><sup>®</sup></div>
      </div>
      <h1>Live football.<br><span>Zero clutter.</span></h1>
      <p>Premier League and Champions League scores, Match Centre and alerts, pinned to your Windows desktop.</p>
      <div class="chips">
        <span class="chip">Windows 10/11</span>
        <span class="chip">No account needed</span>
      </div>
    </div>
  </div>
</body>
</html>`,
    { waitUntil: 'load' },
  );
  await settle(page);
  await page.screenshot({ path: join(brand, 'banner.png'), omitBackground: true });
  await page.close();
};

console.log('Building README images…');
const server = spawn(
  process.execPath,
  [
    join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview',
    '--configLoader',
    'runner',
    '--host',
    '127.0.0.1',
    '--port',
    '1421',
    '--strictPort',
  ],
  { cwd: root, stdio: 'inherit' },
);

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    try {
      const response = await fetch(baseURL);
      ready = response.ok;
    } catch {
      await sleep(250);
    }
  }
  if (!ready) throw new Error(`Preview server did not start at ${baseURL}`);

  await mkdir(screenshots, { recursive: true });
  await mkdir(brand, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge' });

  await writeBanner(browser);

  for (const theme of ['dark', 'light']) {
    const page = await openWidget(browser, theme);
    await page.screenshot({ path: join(screenshots, `widget-${theme}.png`), omitBackground: true });
    await page.locator('[data-match-id="401879268"] .match-open').click();
    await page.getByRole('tab', { name: 'Stats', exact: true }).waitFor();
    await settle(page);
    const suffix = theme === 'dark' ? '' : '-light';
    await page.screenshot({ path: join(screenshots, `match-centre-overview${suffix}.png`), omitBackground: true });
    await page.getByRole('tab', { name: 'Stats', exact: true }).click();
    await settle(page);
    await page.screenshot({ path: join(screenshots, `match-centre-stats${suffix}.png`), omitBackground: true });
    await page.close();
  }

  console.log(`Wrote README images to ${screenshots} and ${brand}`);
} finally {
  await browser?.close();
  server.kill();
}

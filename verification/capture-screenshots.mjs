// Rebuilds the README screenshots from the current UI.
// Usage: npm run screenshots
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'screenshots');
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
  team.statistics.map((stat) => ({ teamId: team.team.id, name: stat.name, label: stat.label, value: stat.displayValue })));
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
  })));
const substitutions = events
  .filter((event) => event.kind === 'substitution' && event.participants.length === 2)
  .map((event) => ({ teamId: event.teamId, playerIn: event.participants[0], playerOut: event.participants[1], minute: event.minute }));
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
const snapshot = {
  updatedAt: new Date(now).toISOString(),
  settings: {
    matchAlerts: {},
    favorites: ['359', '364'],
    followedOnly: false,
    compact: false,
    alwaysOnTop: true,
    startHidden: false,
    reducedMotion: true,
    opacity: 96,
    theme: 'dark',
    competitionView: 'premierLeague',
    reminders: true,
    reminderMinutes: 15,
    starts: true,
    goals: false,
  },
  matches: [
    { id: 'live-city-liverpool', league: 'premierLeague', competition: 'Premier League', home: { id: '382', name: 'Manchester City', short: 'MCI' }, away: { id: '364', name: 'Liverpool', short: 'LIV' }, homeScore: 1, awayScore: 1, kickoff: iso(-67), status: 'live', detail: "67'" },
    { id: 'live-newcastle-spurs', league: 'premierLeague', competition: 'Premier League', home: { id: '361', name: 'Newcastle United', short: 'NEW' }, away: { id: '367', name: 'Tottenham Hotspur', short: 'TOT' }, homeScore: 0, awayScore: 2, kickoff: iso(-72), status: 'live', detail: "72'" },
    { id: '401879268', league: 'premierLeague', competition: 'Premier League', home: arsenal, away: leeds, homeScore: 2, awayScore: 1, kickoff: iso(-180), status: 'fulltime', detail: 'Full-time' },
    { id: 'next-villa-brighton', league: 'premierLeague', competition: 'Premier League', home: { id: '362', name: 'Aston Villa', short: 'AVL' }, away: { id: '331', name: 'Brighton & Hove Albion', short: 'BHA' }, kickoff: iso(150), status: 'scheduled', detail: 'Scheduled' },
  ],
};
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
    await Promise.all([...document.images].map((image) => image.complete
      ? undefined
      : new Promise((done) => { image.onload = image.onerror = done; })));
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

console.log('Building screenshot pages…');
const server = spawn(process.execPath, [
  join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'preview', '--configLoader', 'runner', '--host', '127.0.0.1', '--port', '1421', '--strictPort',
], { cwd: root, stdio: 'inherit' });

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

  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 700 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'dark',
  });
  await serveCrests(page);
  await page.addInitScript(installBridge, { snapshot, summary });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await settle(page);
  await page.screenshot({ path: join(output, 'widget-dark.png'), omitBackground: true });

  await page.getByRole('button', { name: /Match details: Arsenal versus Leeds United/ }).click();
  await page.getByRole('tab', { name: 'Stats', exact: true }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(output, 'match-centre-overview.png'), omitBackground: true });

  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await settle(page);
  await page.screenshot({ path: join(output, 'match-centre-stats.png'), omitBackground: true });
  console.log(`Wrote screenshots to ${output}`);
} finally {
  await browser?.close();
  server.kill();
}

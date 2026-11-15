// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import App from './App';
import { clubs, mockSnapshot } from './test-fixtures/fixtures';
import { useApp } from './store';
import { shortCountdown } from './countdown';
import { formatMinute, relativeAge } from './presentation';
import { teamCode } from './teams';
import type { Match, Snapshot } from './types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));

afterEach(cleanup);

async function load(snapshot: Snapshot) {
  useApp.setState({ snapshot, loading: false, error: null });
  await useApp.getState().load();
}
const inDays = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const fixture = (id: string, home: number, away: number, kickoff: string): Match =>
  ({ id, league: 'premierLeague', competition: 'Premier League', home: clubs[home], away: clubs[away], kickoff, status: 'scheduled', detail: 'Scheduled' });

describe('fixture list tabs and grouping', () => {
  it('shows a match count on each tab without changing its accessible name', async () => {
    await load(structuredClone(mockSnapshot));
    render(<App />);
    const live = screen.getByRole('button', { name: 'Live' });
    // demo-1, demo-2, demo-7 and the suspended demo-11 are in progress.
    expect(within(live).getByText('4')).toBeTruthy();
    expect(live.getAttribute('title')).toBe('4 matches');
  });

  it('dims tabs with no matches', async () => {
    const snapshot = structuredClone(mockSnapshot);
    snapshot.matches = [fixture('a', 9, 10, inDays(3, 15))];
    await load(snapshot);
    render(<App />);
    expect(screen.getByRole('button', { name: 'Live' }).className).toContain('is-empty');
    expect(screen.getByRole('button', { name: 'Upcoming' }).className).not.toContain('is-empty');
  });

  it('labels followed clubs ahead of other matches on the same day, and spells out the count', async () => {
    const snapshot = structuredClone(mockSnapshot);
    // Arsenal (followed) kicks off later than Brighton v Wolves but is listed first.
    snapshot.matches = [fixture('other', 9, 10, inDays(3, 13)), fixture('followed', 0, 6, inDays(3, 17))];
    await load(snapshot);
    render(<App />);
    const labels = screen.getAllByText(/^(Your clubs|Other matches)$/).map(node => node.textContent);
    expect(labels).toEqual(['Your clubs', 'Other matches']);
    expect(screen.getByText('2 matches')).toBeTruthy();
  });

  it('does not add sub-headings when a day has only one kind of match', async () => {
    const snapshot = structuredClone(mockSnapshot);
    snapshot.matches = [fixture('x', 9, 10, inDays(3, 13)), fixture('y', 11, 12, inDays(3, 15))];
    await load(snapshot);
    render(<App />);
    expect(screen.queryByText('Your clubs')).toBeNull();
    expect(screen.queryByText('Other matches')).toBeNull();
  });
});

describe('display helpers', () => {
  const now = new Date('2026-11-13T10:00:00Z');
  it('shortCountdown uses one unit', () => {
    expect(shortCountdown('2026-11-21T14:30:00Z', now)).toBe('8d');
    expect(shortCountdown('2026-11-13T15:30:00Z', now)).toBe('5h');
    expect(shortCountdown('2026-11-13T10:40:00Z', now)).toBe('40m');
    expect(shortCountdown('2026-11-13T10:02:00Z', now)).toBe('Soon');
    expect(shortCountdown('not a date', now)).toBeNull();
  });
  it('relativeAge reads as elapsed time', () => {
    const t = now.getTime();
    expect(relativeAge('2026-11-13T09:59:40Z', t)).toBe('just now');
    expect(relativeAge('2026-11-13T09:51:00Z', t)).toBe('9m ago');
    expect(relativeAge('2026-11-13T07:00:00Z', t)).toBe('3h ago');
    expect(relativeAge('bad', t)).toBe('time unavailable');
  });
  it('formatMinute normalises added time', () => {
    expect(formatMinute("90'+7'")).toBe("90+7'");
    expect(formatMinute('45 + 2')).toBe("45+2'");
    expect(formatMinute('34')).toBe("34'");
    expect(formatMinute('HT')).toBe('HT');
  });
  it('teamCode disambiguates the Manchester clubs', () => {
    expect(teamCode({ id: '360', name: 'Manchester United', short: 'MAN' })).toBe('MUN');
    expect(teamCode({ id: '382', name: 'Manchester City', short: 'MAN' })).toBe('MCI');
    expect(teamCode({ id: '86', name: 'Real Madrid', short: 'RMA' })).toBe('RMA');
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { useApp } from './store';
import { mockSnapshot } from './test-fixtures/fixtures';
import type { MatchSummary } from './useMatchSummary';
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('orders result days and matches newest first', async () => {
  const base = mockSnapshot.matches[4];
  const results = [
    { ...base, id: 'old', kickoff: '2026-10-20T12:00:00Z' },
    { ...base, id: 'new', kickoff: '2026-10-22T16:00:00Z' },
    { ...base, id: 'middle', kickoff: '2026-10-22T12:00:00Z' },
  ];
  const snapshot = { ...structuredClone(mockSnapshot), matches: [], settings: { ...mockSnapshot.settings } };
  bridge.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: results, updatedAt: '2026-10-29T12:00:00Z', error: null };
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
  await waitFor(() => expect(document.querySelectorAll('[data-match-id]')).toHaveLength(3));
  expect([...document.querySelectorAll<HTMLElement>('[data-match-id]')].map((card) => card.dataset.matchId)).toEqual([
    'new',
    'middle',
    'old',
  ]);
});
it('shows a result outside yesterday/today and fetches its summary only when opened', async () => {
  const completed = { ...mockSnapshot.matches[4], id: '401879268', kickoff: '2026-10-20T12:00:00Z' };
  const snapshot = { ...structuredClone(mockSnapshot), matches: [], settings: { ...mockSnapshot.settings } };
  bridge.invoke.mockImplementation(async (cmd: string, args?: { id: string }) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: [completed], updatedAt: '2026-10-29T12:00:00Z', error: null };
    if (cmd === 'get_match_details')
      return {
        matchId: args?.id,
        venue: null,
        updatedAt: '2026-10-29T12:00:00Z',
        stale: false,
        error: null,
        events: [],
        statistics: [],
        players: [],
      };
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  await waitFor(() => expect(screen.getByText('No fixtures in this window')).toBeTruthy());
  expect(bridge.invoke.mock.calls.some((c) => c[0] === 'get_recent_results')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Results' }));
  const card = await screen.findByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ });
  expect(bridge.invoke.mock.calls.some((c) => c[0] === 'get_match_details')).toBe(false);
  fireEvent.click(card);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('get_match_details', { id: '401879268' }));
  expect(screen.getByRole('heading', { name: 'Match details' })).toBeTruthy();
});

it('shows a completed provider summary through Results, including events, statistics and both lineups', async () => {
  const completed = {
    ...mockSnapshot.matches[0],
    id: '401879268',
    status: 'fulltime' as const,
    homeScore: 2,
    awayScore: 1,
    home: { id: '359', name: 'Arsenal', short: 'ARS' },
    away: { id: '357', name: 'Leeds United', short: 'LEE' },
    kickoff: '2026-10-20T12:00:00Z',
  };
  // Normalized IPC subset based on the recorded ESPN response, with one test-only red card.
  const summary: MatchSummary = {
    matchId: completed.id,
    venue: 'Emirates Stadium',
    updatedAt: '2026-10-29T12:00:00Z',
    stale: false,
    error: null,
    events: [
      {
        id: '53362804',
        minute: "36'",
        period: 1,
        seconds: 2160,
        kind: 'yellow-card',
        text: 'Ao Tanaka (Leeds United) is shown the yellow card for a bad foul.',
        teamId: '357',
      },
      {
        id: '53365035',
        minute: "55'",
        period: 2,
        seconds: 3300,
        kind: 'goal',
        text: 'Goal! Arsenal 0, Leeds United 1. James Justin (Leeds United) right footed shot from the right side of the box to the top left corner. Assisted by Gabriel Gudmundsson with a cross.',
        teamId: '357',
      },
      {
        id: 'sub',
        minute: "63'",
        period: 2,
        seconds: 3780,
        kind: 'substitution',
        text: 'Substitution, Arsenal. Jurriën Timber replaces Ben White.',
        teamId: '359',
      },
      {
        id: 'test-red-card',
        minute: "80'",
        period: 2,
        seconds: 4800,
        kind: 'red-card',
        text: 'A player is shown a red card.',
        teamId: '357',
      },
    ],
    statistics: [
      { teamId: '359', name: 'possessionPct', label: 'Possession', value: '58.2' },
      { teamId: '357', name: 'possessionPct', label: 'Possession', value: '41.8' },
    ],
    players: [
      { teamId: '359', name: 'David Raya', position: 'G', starter: true },
      { teamId: '357', name: 'James Trafford', position: 'G', starter: true },
      { teamId: '359', name: 'Bruno Guimarães', position: 'SUB', starter: false },
    ],
  };
  const snapshot = { ...structuredClone(mockSnapshot), matches: [] };
  bridge.invoke.mockImplementation(async (cmd: string, args?: { id: string }) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: [completed], updatedAt: '2026-10-29T12:00:00Z', error: null };
    if (cmd === 'get_match_details' && args?.id === completed.id) return summary;
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  await screen.findByRole('button', { name: 'Results' });
  fireEvent.click(screen.getByRole('button', { name: 'Results' }));
  const card = await screen.findByRole('button', { name: /Match details:.*Arsenal.*Leeds United/ });
  expect(bridge.invoke.mock.calls.some((c) => c[0] === 'get_match_details')).toBe(false);
  fireEvent.click(card);
  await screen.findByText('Emirates Stadium');
  fireEvent.click(screen.getByRole('tab', { name: 'Commentary' }));
  expect(screen.getByText(/Ao Tanaka.*yellow card/)).toBeTruthy();
  expect(screen.getByText(/James Justin.*right footed shot/)).toBeTruthy();
  expect(screen.getByText(/Timber replaces Ben White/)).toBeTruthy();
  expect(screen.getByText('A player is shown a red card.')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));
  expect(screen.getByRole('row', { name: /Possession/ }).textContent).toBe('58.2%Possession41.8%');
  fireEvent.click(screen.getByRole('tab', { name: 'Lineups' }));
  expect(screen.getByText('Starting XI')).toBeTruthy();
  expect(screen.getByText('David Raya')).toBeTruthy();
  expect(screen.getByText('Bruno Guimarães')).toBeTruthy();
  expect(screen.getByText('Substitutes')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Leeds United/ }));
  expect(screen.getByText('James Trafford')).toBeTruthy();
  expect(screen.getByText('Starting XI')).toBeTruthy();
  expect(bridge.invoke.mock.calls.filter((c) => c[0] === 'get_match_details')).toHaveLength(1);
});

it('uses a newer corrected result in both the result card and the opened match', async () => {
  const stale = {
    ...mockSnapshot.matches[4],
    id: '401879268',
    homeScore: 1,
    awayScore: 1,
    scoreUpdatedAt: '2026-11-08T12:00:00Z',
  };
  const corrected = { ...stale, homeScore: 2, scoreUpdatedAt: '2026-11-08T13:00:00Z' };
  const snapshot = { ...structuredClone(mockSnapshot), matches: [stale] };
  bridge.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: [corrected], updatedAt: corrected.scoreUpdatedAt, error: null };
    if (cmd === 'get_match_details')
      return {
        matchId: corrected.id,
        matchState: 'post',
        venue: null,
        updatedAt: corrected.scoreUpdatedAt,
        stale: false,
        error: null,
        events: [],
        statistics: [],
        players: [],
      };
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
  const card = await screen.findByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ });
  await waitFor(() => expect(card.querySelector('.scores')?.textContent).toBe('21'));
  fireEvent.click(card);
  await waitFor(() => expect(document.querySelector('.detail-score>span')?.textContent).toBe('2 – 1'));
});

it('marks a complete results list without claiming a day count', async () => {
  const completed = { ...mockSnapshot.matches[4], id: 'result-1', kickoff: '2026-10-22T16:00:00Z' };
  const snapshot = { ...structuredClone(mockSnapshot), matches: [], settings: { ...mockSnapshot.settings } };
  bridge.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: [completed], updatedAt: '2026-10-29T12:00:00Z', error: null };
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
  await screen.findByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ });
  expect(document.querySelector('.list-end')?.textContent).toMatch(/That’s every recent result/);
});

it('says results were found recently instead of naming a window the backend exceeds', async () => {
  const snapshot = { ...structuredClone(mockSnapshot), matches: [], settings: { ...mockSnapshot.settings } };
  bridge.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_snapshot') return snapshot;
    if (cmd === 'get_recent_results') return { matches: [], updatedAt: '2026-10-29T12:00:00Z', error: null };
    throw Error('Unexpected command ' + cmd);
  });
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
  await waitFor(() => expect(screen.getByText(/were found recently\./)).toBeTruthy());
});

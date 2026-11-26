// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import App, { trackScores } from './App';
import { mockSnapshot } from './test-fixtures/fixtures';
import { useApp } from './store';
import type { Match } from './types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const lifetime = 3 * 60_000;
const emptyTracking = () => ({ previousScores: new Map(), scoreChanges: {} });
const match = (id: string, homeScore = 0, awayScore = 0): Match => ({
  ...mockSnapshot.matches[0],
  id,
  homeScore,
  awayScore,
});

describe('score tracking', () => {
  it('seeds the initial scores without false change indicators', () => {
    const initial = trackScores([match('a', 2, 1), match('b')], emptyTracking(), 1000);
    expect([...initial.previousScores]).toEqual([
      ['a', [2, 1]],
      ['b', [0, 0]],
    ]);
    expect(initial.scoreChanges).toEqual({});
  });

  it('prunes all state for an empty feed and treats returning matches as new', () => {
    const initial = trackScores([match('a')], emptyTracking(), 0);
    const changed = trackScores([match('a', 1)], initial, 1000);
    expect(changed.scoreChanges.a).toEqual({ at: 1000, home: true, away: false });
    const empty = trackScores([], changed, 2000);
    expect(empty.previousScores.size).toBe(0);
    expect(empty.scoreChanges).toEqual({});
    expect(trackScores([match('a', 2)], empty, 3000).scoreChanges).toEqual({});
  });

  it('prunes rolling replacements while preserving and renewing genuine changes', () => {
    const initial = trackScores([match('leaving'), match('remaining'), match('expiring')], emptyTracking(), 0);
    const changed = trackScores([match('leaving', 1), match('remaining', 1), match('expiring', 1)], initial, 1000);
    const rolling = trackScores([match('remaining', 1), match('expiring', 1), match('new', 3)], changed, 2000);
    expect([...rolling.previousScores.keys()]).toEqual(['remaining', 'expiring', 'new']);
    expect(rolling.scoreChanges).toEqual({
      remaining: { at: 1000, home: true, away: false },
      expiring: { at: 1000, home: true, away: false },
    });
    const next = trackScores(
      [match('remaining', 1, 1), match('expiring', 1), match('new', 3)],
      rolling,
      1000 + lifetime,
    );
    expect(next.scoreChanges).toEqual({ remaining: { at: 1000 + lifetime, home: false, away: true } });
    expect([...next.previousScores]).toEqual([
      ['remaining', [1, 1]],
      ['expiring', [1, 0]],
      ['new', [3, 0]],
    ]);
    expect(trackScores([match('remaining', 1, 1)], next, 1000 + 2 * lifetime).scoreChanges).toEqual({});
    expect(initial.previousScores.get('remaining')).toEqual([0, 0]);
  });

  it('does not treat unavailable scores as a goal or their recovery as a change', () => {
    const initial = trackScores([match('a')], emptyTracking(), 0);
    const unavailable = trackScores([{ ...match('a'), homeScore: null, awayScore: undefined }], initial, 1000);
    expect(unavailable.previousScores.get('a')).toEqual([null, undefined]);
    expect(unavailable.scoreChanges).toEqual({});
    expect(trackScores([match('a', 1)], unavailable, 2000).scoreChanges).toEqual({});
  });

  it('returns the same state object when neither scores nor highlights change', () => {
    const initial = trackScores([match('a', 1), match('b', 2)], emptyTracking(), 1000);
    expect(trackScores([match('a', 1), match('b', 2)], initial, 31_000)).toBe(initial);
    const changed = trackScores([match('a', 2), match('b', 2)], initial, 32_000);
    expect(changed.scoreChanges.a).toEqual({ at: 32_000, home: true, away: false });
    const expired = trackScores([match('a', 2), match('b', 2)], changed, 32_000 + lifetime);
    expect(expired).not.toBe(changed);
    expect(expired.scoreChanges).toEqual({});
  });

  it('preserves scores through a missing snapshot and flags changes after recovery', async () => {
    const snapshot = structuredClone(mockSnapshot);
    useApp.setState({ snapshot, loading: false, error: null });
    await useApp.getState().load();
    vi.useFakeTimers();
    const { container } = render(<App />);
    expect(container.querySelector('.score-changed')).toBeNull();
    act(() => useApp.setState({ snapshot: null, loading: true }));
    act(() => vi.advanceTimersByTime(30_000));
    const recovered = structuredClone(snapshot);
    const live = recovered.matches.find((item) => item.status === 'live' && item.homeScore != null)!;
    live.homeScore! += 1;
    act(() => useApp.setState({ snapshot: recovered, loading: false }));
    const card = container.querySelector(`[data-match-id="${live.id}"]`)!;
    expect(card.classList.contains('score-changed')).toBe(true);
    expect(card.querySelectorAll('.just-changed')).toHaveLength(1);
  });

  it('shows real score changes in App and expires them without another feed update', async () => {
    const snapshot = structuredClone(mockSnapshot);
    useApp.setState({ snapshot, loading: false, error: null });
    await useApp.getState().load();
    vi.useFakeTimers();
    const { container } = render(<App />);
    expect(container.querySelector('.score-changed')).toBeNull();
    const next = structuredClone(snapshot);
    const live = next.matches.find((item) => item.status === 'live' && item.homeScore != null)!;
    live.homeScore! += 1;
    act(() => useApp.setState({ snapshot: next }));
    const card = () => container.querySelector(`[data-match-id="${live.id}"]`)!;
    expect(card().classList.contains('score-changed')).toBe(true);
    expect(card().querySelectorAll('.just-changed')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(lifetime));
    expect(card().classList.contains('score-changed')).toBe(false);
    expect(card().querySelector('.just-changed')).toBeNull();
    act(() => useApp.setState({ snapshot: { ...next, matches: [] } }));
    expect(container.querySelector('.match-card')).toBeNull();
  });
});

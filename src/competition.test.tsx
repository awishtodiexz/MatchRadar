// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { mockSnapshotWithUcl, uclMatch } from './test-fixtures/fixtures';
import { competitionStatus, resultsStatus } from './freshness';
import { useApp } from './store';
import type { Snapshot } from './types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));

async function load(snapshot: Snapshot) {
  useApp.setState({ snapshot, loading: false, error: null });
  await useApp.getState().load();
}
const premierValue = (name: string) => screen.getByRole('button', { name: new RegExp(`Competition: ${name}.*Change competition`) });

beforeEach(async () => { await load(structuredClone(mockSnapshotWithUcl)); });
afterEach(cleanup);

describe('competition selector', () => {
  it('defaults to the Premier League and hides Champions League fixtures', () => {
    render(<App />);
    expect(premierValue('Premier League')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Match details:.*Real Madrid.*Bayern Munich/ })).toBeNull();
    expect(screen.getByLabelText(/Premier League: 4 live matches/)).toBeTruthy();
  });

  it('switches to Champions League and persists the choice optimistically', async () => {
    render(<App />);
    fireEvent.click(premierValue('Premier League'));
    fireEvent.click(screen.getByRole('option', { name: /^Champions League/ }));
    await waitFor(() => expect(premierValue('Champions League')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Match details:.*Real Madrid.*Bayern Munich/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeNull();
    expect(useApp.getState().snapshot?.settings.competitionView).toBe('championsLeague');
    expect(screen.getByLabelText(/Champions League: checking live status/)).toBeTruthy();
    expect(screen.getByText('CHECKING LIVE',{exact:true})).toBeTruthy();
    expect(screen.getByText('CONNECTING')).toBeTruthy();
  });

  it('keeps a failed Champions League score check unavailable instead of checking', async () => {
    const base=structuredClone(mockSnapshotWithUcl);
    await load({...base,leagueStatus:{'uefa.champions':{scoreError:'HTTP 503'}}});
    render(<App />);
    fireEvent.click(premierValue('Premier League'));
    fireEvent.click(screen.getByRole('option', { name: /^Champions League/ }));
    expect(screen.getByLabelText(/Champions League: live status unavailable/)).toBeTruthy();
    expect(screen.queryByText('CHECKING LIVE')).toBeNull();
    expect(screen.getByText(/UPDATE FAILED/)).toBeTruthy();
  });

  it('reports a confirmed quiet Champions League score check as no live matches', async () => {
    const base=structuredClone(mockSnapshotWithUcl);
    await load({...base,leagueStatus:{'uefa.champions':{updatedAt:'2026-10-29T12:00:00Z',fixtureUpdatedAt:'2026-10-29T11:00:00Z'}}});
    render(<App />);
    fireEvent.click(premierValue('Premier League'));
    fireEvent.click(screen.getByRole('option', { name: /^Champions League/ }));
    expect(screen.getByLabelText(/Champions League: no confirmed live matches/)).toBeTruthy();
    expect(screen.getByText('NO LIVE MATCHES',{exact:true})).toBeTruthy();
    expect(screen.queryByText('CHECKING LIVE')).toBeNull();
    expect(screen.getByText('SCORES CHECKED')).toBeTruthy();
  });

  it('shows both competitions chronologically with per-match competition tags', async () => {
    render(<App />);
    fireEvent.click(premierValue('Premier League'));
    fireEvent.click(screen.getByRole('option', { name: /Both competitions/ }));
    await waitFor(() => expect(premierValue('Both competitions')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Match details:.*Real Madrid.*Bayern Munich/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeTruthy();
    expect(screen.getAllByText('UCL').length).toBe(1);
    expect(screen.getAllByText('PL').length).toBeGreaterThan(0);
    const cards = [...document.querySelectorAll<HTMLElement>('[data-match-id]')].map(card => card.dataset.matchId);
    expect(cards).toContain(uclMatch.id);
    // The visual PL/UCL tag is hidden from name computation, so the card
    // description carries the competition and the article gets a matching name.
    const uclCard = screen.getByRole('button', { name: /Match details:.*Real Madrid.*Bayern Munich/ });
    expect(document.getElementById(uclCard.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Champions League');
    expect(uclCard.closest('article')?.getAttribute('aria-labelledby')).toBe(uclCard.id);
    const plCard = screen.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ });
    expect(document.getElementById(plCard.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Premier League');
    // Chronological/day ordering is covered deterministically in fixtures.test.ts.
  });

  it('supports keyboard opening and Escape without leaving the view', async () => {
    render(<App />);
    const trigger = premierValue('Premier League');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox', { name: 'Competition' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('option', { name: /^Champions League/ }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Competition' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Fixture views' })).toBeTruthy();
  });

  it('counts live matches only for the selected competition', async () => {
    const snapshot = structuredClone(mockSnapshotWithUcl);
    snapshot.matches = snapshot.matches.map(match => match.id === 'demo-1'
      ? { ...match, status: 'live' as const }
      : match.id === uclMatch.id ? { ...match, status: 'live' as const, homeScore: 1, awayScore: 0 }
      : match.league === 'premierLeague' && (match.status === 'live' || match.status === 'halftime')
        ? { ...match, status: 'scheduled' as const }
        : match);
    await load(snapshot);
    render(<App />);
    expect(screen.getByLabelText(/Premier League: 2 live matches/)).toBeTruthy();
    fireEvent.click(premierValue('Premier League'));
    fireEvent.click(screen.getByRole('option', { name: /^Champions League/ }));
    await waitFor(() => expect(screen.getByLabelText(/Champions League: 1 live matches/)).toBeTruthy());
    fireEvent.click(premierValue('Champions League'));
    fireEvent.click(screen.getByRole('option', { name: /Both competitions/ }));
    await waitFor(() => expect(screen.getByLabelText(/Both competitions: 3 live matches/)).toBeTruthy());
  });

  it('tolerates legacy snapshots without a competition view', async () => {
    const legacy = structuredClone(mockSnapshotWithUcl);
    delete (legacy.settings as Partial<Snapshot['settings']>).competitionView;
    await load(legacy);
    render(<App />);
    expect(premierValue('Premier League')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeTruthy();
  });
});

describe('consumers of competition status', () => {
  it('keeps a failure in one competition out of the other status', () => {
    const snapshot = structuredClone(mockSnapshotWithUcl);
    snapshot.leagueStatus = {
      'eng.1': { updatedAt: '2026-11-06T10:00:00Z' },
      'uefa.champions': { updatedAt: '2026-11-06T09:00:00Z', scoreError: 'HTTP 500' }
    };
    expect(competitionStatus(snapshot, 'premierLeague').error).toBeNull();
    expect(competitionStatus(snapshot, 'championsLeague').error).toContain('HTTP 500');
    const both = competitionStatus(snapshot, 'both');
    expect(both.partial).toBe(true);
    expect(both.error).toContain('Champions League');
    // Both reports the least fresh source, never the best one.
    expect(both.updatedAt).toBe('2026-11-06T09:00:00Z');
  });

  it('scopes results freshness to the selected competition', () => {
    const results = {
      updatedAt: '2026-11-06T10:00:00Z',
      error: null,
      leagues: {
        'eng.1': { updatedAt: '2026-11-06T10:00:00Z', error: null },
        'uefa.champions': { updatedAt: null, error: 'Results unavailable' }
      }
    };
    expect(resultsStatus(results, 'premierLeague').error).toBeNull();
    expect(resultsStatus(results, 'championsLeague').error).toContain('Results unavailable');
    expect(resultsStatus(results, 'both').error).toContain('Champions League');
  });
});

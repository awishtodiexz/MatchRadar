// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { mockSnapshotWithUcl, uclArsenalMatch } from './test-fixtures/fixtures';
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
const picker = () => screen.getByRole('button', { name: /Competition: .*Change competition/ });
async function choose(name: string) {
  const label = name === 'Both' ? 'Both competitions' : name;
  fireEvent.click(picker());
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${label}`) }));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`Competition: ${label}.*Change competition`) })).toBeTruthy());
}
const card = (name: string) => screen.queryByRole('button', { name: new RegExp(`Match details:.*${name.split(' versus ').join('.*')}`) });

beforeEach(async () => { await load(structuredClone(mockSnapshotWithUcl)); });
afterEach(cleanup);

describe('unified club following', () => {
  it('organizes followed, Premier League and other clubs without duplicating them', async () => {
    const snapshot = structuredClone(mockSnapshotWithUcl);
    snapshot.settings.matchAlerts = { 'demo-1': { enabled: true, expiresAt: '2099-01-01T00:00:00Z' } };
    await load(snapshot);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Your clubs' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Followed clubs/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Premier League clubs/ })).toBeTruthy();
    const other = screen.getByRole('button', { name: /Other clubs/ });
    expect(other.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Real Madrid' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Arsenal' })).toHaveLength(1);

    fireEvent.click(other);
    expect(other.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Real Madrid' }));
    await waitFor(() => expect(useApp.getState().snapshot?.settings.favorites).toContain('86'));
    expect(screen.getByRole('button', { name: 'Real Madrid' })).toBeTruthy();
    expect(useApp.getState().snapshot?.settings.favorites.filter(id => id === '86')).toHaveLength(1);
    expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(true);
  });

  it('moves an unfollowed Premier League club back into the main list', async () => {
    const snapshot = structuredClone(mockSnapshotWithUcl);
    snapshot.settings.matchAlerts = { 'demo-1': { enabled: true, expiresAt: '2099-01-01T00:00:00Z' } };
    await load(snapshot);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    fireEvent.click(screen.getByRole('button', { name: 'Arsenal' }));
    await waitFor(() => expect(useApp.getState().snapshot?.settings.favorites).not.toContain('359'));
    const premier = screen.getByRole('heading', { name: /Premier League clubs/ }).closest('section')!;
    expect(within(premier).getByRole('button', { name: 'Arsenal' })).toBeTruthy();
    expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(true);
  });

  it('searches every group, including collapsed other clubs', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const search = screen.getByRole('searchbox', { name: 'Search clubs' });
    fireEvent.change(search, { target: { value: 'Real Madrid' } });
    expect(screen.getByRole('button', { name: 'Real Madrid' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'no such club' } });
    expect(screen.getByText(/No clubs match/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe('');
  });
});

describe('following filter across competitions', () => {
  const followedSnapshot = () => {
    const snapshot = structuredClone(mockSnapshotWithUcl);
    snapshot.matches = [...snapshot.matches, uclArsenalMatch];
    snapshot.settings.favorites = ['359'];
    snapshot.settings.followedOnly = true;
    snapshot.settings.competitionView = 'championsLeague';
    return snapshot;
  };

  it('shows a followed Premier League club UCL fixture without following it twice', async () => {
    await load(followedSnapshot());
    render(<App />);
    expect(card('Arsenal versus Bayern Munich')).toBeTruthy();
    expect(card('Real Madrid versus Bayern Munich')).toBeNull();
    expect(card('Arsenal versus Chelsea')).toBeNull();
    await choose('Both');
    expect(card('Arsenal versus Bayern Munich')).toBeTruthy();
    expect(card('Arsenal versus Chelsea')).toBeTruthy();
    expect(card('Chelsea versus Liverpool')).toBeNull();
    await choose('Premier League');
    expect(card('Arsenal versus Chelsea')).toBeTruthy();
    expect(card('Arsenal versus Bayern Munich')).toBeNull();
    expect(useApp.getState().snapshot?.settings.followedOnly).toBe(true);
  });

  it('distinguishes an empty Following result from an empty UCL schedule', async () => {
    const filtered = followedSnapshot();
    filtered.settings.favorites = ['999'];
    await load(filtered);
    const filteredView = render(<App />);
    expect(screen.getByText('No matches involving followed clubs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show all matches' })).toBeTruthy();
    filteredView.unmount();
    await load({ ...filtered, matches: [] });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Following only' }));
    expect(screen.getByText('No fixtures in this window')).toBeTruthy();
    expect(screen.queryByText('No matches involving followed clubs')).toBeNull();
  });

  it('keeps Following independent of the selected view across competitions', async () => {
    await load(followedSnapshot());
    render(<App />);
    await choose('Premier League');
    await choose('Both');
    await choose('Champions League');
    expect(screen.getByRole('button', { name: 'Following only' }).getAttribute('aria-pressed')).toBe('true');
    expect(card('Real Madrid versus Bayern Munich')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(card('Real Madrid versus Bayern Munich')).toBeNull();
    expect(useApp.getState().snapshot?.settings.followedOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Following only' }));
    expect(card('Real Madrid versus Bayern Munich')).toBeTruthy();
    expect(card('Arsenal versus Bayern Munich')).toBeTruthy();
    await waitFor(() => expect(useApp.getState().snapshot?.settings.followedOnly).toBe(false));
    expect(useApp.getState().snapshot?.settings.competitionView).toBe('championsLeague');
    fireEvent.click(screen.getByRole('button', { name: 'Following only' }));
    await waitFor(() => expect(useApp.getState().snapshot?.settings.followedOnly).toBe(true));
  });
});

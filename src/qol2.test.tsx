// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { mockSnapshot } from './test-fixtures/fixtures';
import { useApp } from './store';
import { positionName } from './components/MatchLineups';
import { TickerView } from './components/TickerView';
import type { Snapshot } from './types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));

afterEach(cleanup);

async function load(snapshot: Snapshot) {
  useApp.setState({ snapshot, loading: false, error: null });
  await useApp.getState().load();
}
const pressed = (name: RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('keyboard shortcuts', () => {
  it('switches fixture views with 1–4 but not while typing in a field', async () => {
    await load(structuredClone(mockSnapshot));
    render(<App />);
    fireEvent.keyDown(document.body, { key: '2' });
    expect(pressed(/^Live/)).toBe('true');
    fireEvent.keyDown(document.body, { key: '3' });
    expect(pressed(/^Upcoming/)).toBe('true');
    fireEvent.keyDown(document.body, { key: '/' });
    const search = await screen.findByRole('searchbox', { name: 'Search clubs' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: '1' });
    expect(screen.queryByRole('navigation', { name: 'Fixture views' })).toBeNull();
    fireEvent.keyDown(search, { key: 'Escape' });
  });

  it('steps to the next match in list order with ] from the details view', async () => {
    await load(structuredClone(mockSnapshot));
    const { container } = render(<App />);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.match-open')];
    const idOf = (button: Element) => button.closest('[data-match-id]')?.getAttribute('data-match-id');
    const matchOf = (id?: string | null) => useApp.getState().snapshot!.matches.find(match => match.id === id)!;
    const [first, second] = [matchOf(idOf(buttons[0])), matchOf(idOf(buttons[1]))];
    fireEvent.click(buttons[0]);
    const followButton = (name: string) => screen.queryByRole('button', { name: new RegExp(`^(Un)?follow ${name}$`) });
    expect(followButton(first.home.name)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(followButton(second.home.name)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '[' });
    expect(followButton(first.home.name)).toBeTruthy();
  });
});

describe('score change marker', () => {
  it('flags a card whose score changed since the previous snapshot', async () => {
    const snapshot = structuredClone(mockSnapshot);
    const live = snapshot.matches.find(match => match.status === 'live' && match.homeScore != null)!;
    await load(snapshot);
    const { container } = render(<App />);
    expect(container.querySelector('.score-changed')).toBeNull();
    const next = structuredClone(snapshot);
    const changed = next.matches.find(match => match.id === live.id)!;
    changed.homeScore = (changed.homeScore ?? 0) + 1;
    act(() => useApp.setState({ snapshot: next }));
    const card = container.querySelector(`[data-match-id="${live.id}"]`)!;
    expect(card.classList.contains('score-changed')).toBe(true);
    expect(card.querySelectorAll('.just-changed')).toHaveLength(1);
  });
});

describe('match card menu', () => {
  it('opens on right-click, follows a club, and closes with Escape', async () => {
    const snapshot = structuredClone(mockSnapshot);
    snapshot.settings.favorites = [];
    await load(snapshot);
    const { container } = render(<App />);
    const card = container.querySelector('.match-card')!;
    const match = snapshot.matches.find(item => item.id === card.getAttribute('data-match-id'))!;
    fireEvent.contextMenu(card, { clientX: 40, clientY: 80 });
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('Open match details');
    fireEvent.click(screen.getByRole('menuitem', { name: `Follow ${match.home.name}` }));
    expect(screen.queryByRole('menu')).toBeNull();
    await vi.waitFor(() => expect(useApp.getState().snapshot?.settings.favorites).toContain(match.home.id));
    fireEvent.contextMenu(card, { clientX: 40, clientY: 80 });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menu).toBeTruthy();
    // Escape closed only the menu, not the home view.
    expect(screen.getByRole('navigation', { name: 'Fixture views' })).toBeTruthy();
  });
});

describe('lineup position names', () => {
  it('expands provider position codes', () => {
    expect(positionName('CD-R')).toBe('Centre-back (right)');
    expect(positionName('AM-L')).toBe('Attacking midfielder (left)');
    expect(positionName('G')).toBe('Goalkeeper');
    expect(positionName('XYZ')).toBeUndefined();
  });
});

describe('ticker', () => {
  it('opens the shown match when an open handler is provided', () => {
    const match = mockSnapshot.matches[0];
    const onOpen = vi.fn(), onExpand = vi.fn();
    render(<TickerView match={match} onExpand={onExpand} onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle('Open this match in MatchRadar'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });
});

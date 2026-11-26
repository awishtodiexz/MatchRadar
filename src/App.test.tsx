// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useApp } from './store';
import { mockSnapshot } from './test-fixtures/fixtures';
import type { Snapshot } from './types';

import { isAppVisible, setNativeVisible } from './windowVisibility';

const bridge = vi.hoisted(() => ({
  native: false,
  invoke: vi.fn(),
  listen: vi.fn(),
  hide: vi.fn(),
  isVisible: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ hide: bridge.hide, isVisible: bridge.isVisible }),
}));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));

async function load(snapshot: Snapshot) {
  useApp.setState({ snapshot, loading: false, error: null });
  await useApp.getState().load();
}

beforeEach(() => {
  bridge.native = false;
  bridge.invoke.mockReset();
  bridge.listen.mockReset().mockResolvedValue(() => {});
  bridge.hide.mockReset().mockResolvedValue(undefined);
  bridge.isVisible.mockReset().mockResolvedValue(true);
  setNativeVisible(true);
});
afterEach(cleanup);

it('shows a desktop-only message instead of fictional fixtures in a browser', async () => {
  useApp.setState({ snapshot: null, loading: true, error: null });
  render(<App />);
  expect(await screen.findByText('Match data is available in the desktop app.')).toBeTruthy();
  expect(screen.queryByText('DEMO DATA')).toBeNull();
  expect(screen.queryByRole('button', { name: /Match details:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('keeps the refresh icon still during the fixture cooldown when no update is in flight', async () => {
  await load(structuredClone(mockSnapshot));
  render(<App />);
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh.title).toContain('Just refreshed'));
  expect(refresh.hasAttribute('disabled')).toBe(true);
  expect(refresh.getAttribute('aria-busy')).toBe('false');
  expect(refresh.querySelector('svg')?.classList.contains('spin')).toBe(false);
});

it('clears the fixture cooldown as soon as an asynchronous refresh failure lands', async () => {
  await load(structuredClone(mockSnapshot));
  render(<App />);
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh.title).toContain('Just refreshed'));
  const snapshot = useApp.getState().snapshot;
  if (!snapshot) throw new Error('Expected a loaded snapshot');
  act(() =>
    useApp.setState({
      snapshot: { ...snapshot, refreshing: false, error: 'HTTP 500', scoreError: 'HTTP 500' },
    }),
  );
  await waitFor(() => expect(refresh.hasAttribute('disabled')).toBe(false));
});

it('disables Settings and its shortcut when settings did not load', () => {
  useApp.setState({ snapshot: null, loading: false, error: 'Could not load the widget state.' });
  render(<App />);
  const settings = screen.getByRole('button', { name: 'Settings' });
  expect(settings.hasAttribute('disabled')).toBe(true);
  fireEvent.click(settings);
  expect(settings.getAttribute('aria-pressed')).toBe('false');
  fireEvent.keyDown(document.body, { key: '/' });
  expect(screen.queryByRole('searchbox', { name: 'Search clubs' })).toBeNull();
});

it('registers native listeners before reading the first snapshot', async () => {
  bridge.native = true;
  const order: string[] = [];
  const releases: Array<(unlisten: () => void) => void> = [];
  bridge.listen.mockImplementation((event: string) => {
    order.push(`listen:${event}`);
    return new Promise<() => void>((resolve) => releases.push(resolve));
  });
  bridge.invoke.mockImplementation((command: string) => {
    order.push(command);
    return Promise.resolve(command === 'get_snapshot' ? structuredClone(mockSnapshot) : null);
  });
  render(<App />);
  expect(order).not.toContain('get_snapshot');
  act(() => {
    for (const release of releases) release(() => {});
  });
  await act(async () => {});
  expect(order).toContain('get_snapshot');
  for (const event of ['snapshot-updated', 'open-settings', 'shortcut-unavailable', 'window-visibility'])
    expect(order.indexOf(`listen:${event}`)).toBeLessThan(order.indexOf('get_snapshot'));
});

it('reconciles initial hidden native window state on startup without clobbering newer events', async () => {
  bridge.native = true;
  bridge.invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'get_snapshot' ? structuredClone(mockSnapshot) : null),
  );
  bridge.isVisible.mockResolvedValue(false);
  render(<App />);
  await waitFor(() => expect(isAppVisible()).toBe(false));
  cleanup();

  let emitVisibility: ((event: { payload: boolean }) => void) | null = null;
  let resolveInitialVisibility!: (visible: boolean) => void;
  bridge.listen.mockImplementation((event: string, handler: (event: { payload: boolean }) => void) => {
    if (event === 'window-visibility') emitVisibility = handler;
    return Promise.resolve(() => {});
  });
  bridge.isVisible.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveInitialVisibility = resolve;
      }),
  );
  render(<App />);
  await waitFor(() => expect(emitVisibility).not.toBeNull());
  act(() => emitVisibility?.({ payload: true }));
  act(() => resolveInitialVisibility(false));
  await act(async () => {});
  expect(isAppVisible()).toBe(true);
});

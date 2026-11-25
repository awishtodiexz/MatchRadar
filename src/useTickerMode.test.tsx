// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { useTickerMode } from './useTickerMode';

const bridge = vi.hoisted(() => ({
  innerSize: vi.fn(),
  scaleFactor: vi.fn(),
  setMinSize: vi.fn(),
  setSize: vi.fn(),
  setState: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => bridge }));
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, String(value)),
  };
}

vi.mock('./store', () => ({ useApp: { setState: bridge.setState } }));

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  localStorage.clear();
  bridge.innerSize.mockReset().mockResolvedValue({ toLogical: () => ({ width: 390, height: 112 }) });
  bridge.scaleFactor.mockReset().mockResolvedValue(1.25);
  bridge.setMinSize.mockReset().mockResolvedValue(undefined);
  bridge.setSize.mockReset().mockResolvedValue(undefined);
  bridge.setState.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('restores saved ticker UI state and native logical sizing, then expands to the default after relaunch', async () => {
  localStorage.setItem('matchradar.ticker', 'true');
  const { result } = renderHook(useTickerMode);
  expect(result.current.ticker).toBe(true);
  await waitFor(() => expect(bridge.setSize).toHaveBeenCalledWith(new LogicalSize(390, 112)));
  expect(bridge.setMinSize).toHaveBeenCalledWith(new LogicalSize(320, 112));
  await act(async () => {
    expect(await result.current.toggleTicker()).toBe(true);
  });
  expect(result.current.ticker).toBe(false);
  expect(bridge.setSize).toHaveBeenLastCalledWith(new LogicalSize(390, 700));
  expect(bridge.setMinSize).toHaveBeenLastCalledWith(new LogicalSize(320, 460));
  expect(localStorage.getItem('matchradar.ticker')).toBe('false');
});

it('remembers the expanded size within a session and persists entry into ticker', async () => {
  bridge.innerSize.mockResolvedValue({ toLogical: () => ({ width: 520, height: 880 }) });
  const { result } = renderHook(useTickerMode);
  await act(async () => {
    await result.current.toggleTicker();
  });
  expect(result.current.ticker).toBe(true);
  expect(localStorage.getItem('matchradar.ticker')).toBe('true');
  await act(async () => {
    await result.current.toggleTicker();
  });
  expect(bridge.setSize).toHaveBeenLastCalledWith(new LogicalSize(520, 880));
});

it('uses normal mode for missing or corrupt storage', () => {
  for (const value of [null, '{broken', 'null', '"true"']) {
    if (value !== null) localStorage.setItem('matchradar.ticker', value);
    const { result, unmount } = renderHook(useTickerMode);
    expect(result.current.ticker).toBe(false);
    expect(bridge.setSize).not.toHaveBeenCalled();
    unmount();
  }
});

it('still changes modes when storage throws', async () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  const { result } = renderHook(useTickerMode);
  expect(result.current.ticker).toBe(false);
  await act(async () => {
    expect(await result.current.toggleTicker()).toBe(true);
  });
  expect(result.current.ticker).toBe(true);
  await act(async () => {
    expect(await result.current.toggleTicker()).toBe(true);
  });
  expect(result.current.ticker).toBe(false);
});

it('does not persist a failed native transition', async () => {
  bridge.setSize.mockRejectedValueOnce(new Error('Unavailable'));
  const { result } = renderHook(useTickerMode);
  await act(async () => {
    expect(await result.current.toggleTicker()).toBe(false);
  });
  expect(result.current.ticker).toBe(false);
  expect(localStorage.getItem('matchradar.ticker')).toBeNull();
  expect(bridge.setState).toHaveBeenCalledWith({ error: 'Could not resize the widget.' });
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useApp } from './store';

const KEY = 'matchradar.ticker';
const SIZE_KEY = 'matchradar.tickerRestoreSize';
const DEFAULT_SIZE = { width: 390, height: 700 };

function readTicker() {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

function readRestoreSize() {
  try {
    const value = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null');
    if (value && value.width >= 320 && value.height >= 460 && value.width <= 2000 && value.height <= 2000)
      return { width: value.width, height: value.height };
  } catch {
    // Storage is optional.
  }
  return DEFAULT_SIZE;
}

function persistTicker(ticker: boolean) {
  try {
    localStorage.setItem(KEY, String(ticker));
  } catch {
    // Storage is optional; mode changes still work for this session.
  }
}

function persistRestoreSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    // Storage is optional.
  }
}

export function useTickerMode() {
  const [ticker, setTicker] = useState(readTicker);
  const initialTicker = useRef(ticker);
  const mode = useRef(ticker);
  const restoreSize = useRef(readRestoreSize());
  const startup = useRef<Promise<void> | null>(null);
  const resizeQueue = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    if (!initialTicker.current || !isTauri() || startup.current) return;
    const win = getCurrentWindow();
    startup.current = (async () => {
      try {
        const size = (await win.innerSize()).toLogical(await win.scaleFactor());
        await win.setMinSize(new LogicalSize(320, 112));
        await win.setSize(new LogicalSize(Math.max(320, Math.min(size.width, 420)), 112));
      } catch {
        useApp.setState({ error: 'Could not resize the widget.' });
      }
    })();
  }, []);

  const setTickerMode = useCallback((next: boolean) => {
    const operation = async () => {
      await startup.current;
      if (mode.current === next) return true;
      if (isTauri()) {
        const win = getCurrentWindow();
        try {
          if (next) {
            const size = (await win.innerSize()).toLogical(await win.scaleFactor());
            restoreSize.current = { width: size.width, height: size.height };
            persistRestoreSize(restoreSize.current);
            await win.setMinSize(new LogicalSize(320, 112));
            await win.setSize(new LogicalSize(Math.max(320, Math.min(size.width, 420)), 112));
          } else {
            await win.setSize(new LogicalSize(restoreSize.current.width, restoreSize.current.height));
            await win.setMinSize(new LogicalSize(320, 460));
          }
        } catch {
          // The mode never flipped, so restore the minimum matching the mode we
          // are still in; a failed entry must not leave the 112px floor behind.
          void win.setMinSize(new LogicalSize(320, mode.current ? 112 : 460)).catch(() => {});
          useApp.setState({ error: 'Could not resize the widget.' });
          return false;
        }
      }
      persistTicker(next);
      mode.current = next;
      setTicker(next);
      return true;
    };
    const result = resizeQueue.current.then(operation, operation);
    resizeQueue.current = result.catch(() => false);
    return result;
  }, []);

  const toggleTicker = useCallback(() => setTickerMode(!mode.current), [setTickerMode]);

  return { ticker, setTickerMode, toggleTicker };
}

import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useApp } from './store';

const KEY = 'matchradar.ticker';
const DEFAULT_SIZE = { width: 390, height: 700 };

function readTicker() {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

function persistTicker(ticker: boolean) {
  try {
    localStorage.setItem(KEY, String(ticker));
  } catch {
    // Storage is optional; mode changes still work for this session.
  }
}

export function useTickerMode() {
  const [ticker, setTicker] = useState(readTicker);
  const initialTicker = useRef(ticker);
  const restoreSize = useRef(DEFAULT_SIZE);
  const startup = useRef<Promise<void> | null>(null);

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

  const toggleTicker = async () => {
    await startup.current;
    const next = !ticker;
    if (isTauri()) {
      const win = getCurrentWindow();
      try {
        if (next) {
          const size = (await win.innerSize()).toLogical(await win.scaleFactor());
          restoreSize.current = { width: size.width, height: size.height };
          await win.setMinSize(new LogicalSize(320, 112));
          await win.setSize(new LogicalSize(Math.max(320, Math.min(size.width, 420)), 112));
        } else {
          await win.setSize(new LogicalSize(restoreSize.current.width, restoreSize.current.height));
          await win.setMinSize(new LogicalSize(320, 460));
        }
      } catch {
        if (next) void win.setMinSize(new LogicalSize(320, 460)).catch(() => {});
        useApp.setState({ error: 'Could not resize the widget.' });
        return false;
      }
    }
    persistTicker(next);
    setTicker(next);
    return true;
  };

  return { ticker, toggleTicker };
}

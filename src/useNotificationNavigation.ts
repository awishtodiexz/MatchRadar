import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Match } from './types';
import { useApp } from './store';

export interface NotificationTarget {
  requestId: number;
  matchId: string | null;
  match: Match | null;
}

export function useNotificationNavigation(native: boolean, onOpen: (target: NotificationTarget) => void) {
  const callback = useRef(onOpen);
  useEffect(() => {
    callback.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    if (!native) return;
    let disposed = false,
      running = false,
      requested = false;
    let unlisten: (() => void) | undefined;
    const consume = async () => {
      if (disposed) return;
      if (running) {
        requested = true;
        return;
      }
      running = true;
      try {
        do {
          requested = false;
          const target = await invoke<NotificationTarget | null>('get_notification_target');
          if (disposed) return;
          if (target) {
            callback.current(target);
            await invoke('acknowledge_notification_target', { requestId: target.requestId });
          }
        } while (requested && !disposed);
      } catch {
        if (!disposed)
          useApp.setState({
            error: 'Could not open the notification destination. Open the match from the fixture list.',
          });
      } finally {
        running = false;
      }
    };
    // Subscribe before reading pending state, covering clicks during startup.
    void listen('notification-opened', () => {
      void consume();
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        void consume();
      })
      .catch(() => {
        if (!disposed) useApp.setState({ error: 'Could not listen for notification clicks.' });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);
}

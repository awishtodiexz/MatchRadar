import type { Page } from '@playwright/test';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { Snapshot } from '../../src/types';
import type { MatchSummary } from '../../src/useMatchSummary';
import type { NotificationTarget } from '../../src/useNotificationNavigation';

/** Deterministic transport-failure plan for a mocked journey. Counts are consumed once. */
export interface BridgeFailures {
  load?: number;
  refresh?: number;
  save?: number;
  results?: number;
}

export interface BridgeOptions {
  snapshot?: Snapshot;
  details?: 'error' | 'pending';
  summary?: MatchSummary;
  notificationTarget?: NotificationTarget;
  failures?: BridgeFailures;
  /** Write the submitted settings before reporting a save failure (Rust persisted, IPC died). */
  savePersistsBeforeFail?: boolean;
  /** Artificial latency for save_settings, used to exercise the serialized queue. */
  saveDelayMs?: number;
  /** Artificial latency for get_recent_results, used to observe pending states. */
  resultsDelayMs?: number;
  /** Artificial latency for get_snapshot, used to observe the loading skeleton. */
  loadDelayMs?: number;
}

// Test-only desktop bridge. It is injected by Playwright and is never bundled.
// Test hooks (dispatching a CustomEvent on window):
//   test:notification-click  detail: matchId            -> emits notification-opened
//   test:set-snapshot        detail: Snapshot           -> replaces state, emits snapshot-updated
//   test:set-next-snapshot   detail: Snapshot           -> the next refresh command returns it
//   test:set-failures        detail: BridgeFailures     -> adjust failure budget at runtime
//   test:emit                detail: {event,payload}    -> emit any native event
export async function installBridge(page: Page, options: BridgeOptions = {}) {
  await page.addInitScript(
    ({
      snapshot,
      details,
      summary,
      notificationTarget,
      failures,
      savePersistsBeforeFail,
      saveDelayMs,
      resultsDelayMs,
      loadDelayMs,
    }) => {
      let state = snapshot;
      let nextOnRefresh: unknown = null;
      let target = notificationTarget ?? null;
      let requestId = target?.requestId ?? 0;
      let nextCallback = 0,
        nextListener = 0;
      const remaining = {
        load: failures?.load ?? 0,
        refresh: failures?.refresh ?? 0,
        save: failures?.save ?? 0,
        results: failures?.results ?? 0,
      };
      // Read-only observability for assertions: window.__MATCHRADAR_BRIDGE_STATS__.
      const stats = {
        load: 0,
        refresh: 0,
        save: 0,
        results: 0,
        resultsForced: 0,
        detailsForced: 0,
        lastSavedSettings: null as unknown,
        commands: [] as string[],
      };
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      const emit = (event: string, payload: unknown) => {
        for (const [id, listener] of listeners)
          if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      };
      const delay = () =>
        saveDelayMs ? new Promise<void>((resolve) => setTimeout(resolve, saveDelayMs)) : Promise.resolve();
      const wait = (ms?: number) => (ms ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
      window.addEventListener('test:notification-click', (event) => {
        const matchId = (event as CustomEvent<string | null>).detail;
        target = {
          requestId: ++requestId,
          matchId,
          match: state.matches.find((match) => match.id === matchId) ?? null,
        };
        emit('notification-opened', null);
      });
      window.addEventListener('test:set-snapshot', (event) => {
        state = (event as CustomEvent<typeof snapshot>).detail;
        emit('snapshot-updated', null);
      });
      window.addEventListener('test:set-next-snapshot', (event) => {
        nextOnRefresh = (event as CustomEvent<typeof snapshot>).detail;
      });
      window.addEventListener('test:set-failures', (event) => {
        Object.assign(remaining, (event as CustomEvent<Partial<typeof remaining>>).detail);
      });
      window.addEventListener('test:emit', (event) => {
        const { event: name, payload } = (event as CustomEvent<{ event: string; payload: unknown }>).detail;
        emit(name, payload);
      });
      const internals = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++nextCallback;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          stats.commands.push(command);
          if (command === 'plugin:window|inner_size') return { width: window.innerWidth, height: window.innerHeight };
          if (command === 'plugin:window|scale_factor') return 1;
          if (command === 'get_snapshot') {
            stats.load++;
            if (remaining.load > 0) {
              remaining.load--;
              throw new Error('IPC unavailable');
            }
            await wait(loadDelayMs);
            return state;
          }
          if (command === 'refresh') {
            stats.refresh++;
            if (remaining.refresh > 0) {
              remaining.refresh--;
              throw new Error('refresh failed');
            }
            if (nextOnRefresh) {
              state = nextOnRefresh;
              nextOnRefresh = null;
            }
            return null;
          }
          if (command === 'get_notification_target') return target;
          if (command === 'acknowledge_notification_target') {
            if (target?.requestId === args.requestId) target = null;
            return;
          }
          if (command === 'save_settings') {
            stats.save++;
            stats.lastSavedSettings = args.settings ?? null;
            await delay();
            if (remaining.save > 0) {
              remaining.save--;
              if (savePersistsBeforeFail) state = { ...state, settings: args.settings as typeof state.settings };
              throw new Error('save failed');
            }
            state = { ...state, settings: args.settings as typeof state.settings };
            return state.settings;
          }
          if (command === 'get_recent_results') {
            stats.results++;
            if (args.force) stats.resultsForced++;
            await wait(resultsDelayMs);
            if (remaining.results > 0) {
              remaining.results--;
              throw new Error('results unavailable');
            }
            return {
              matches: state.matches.filter((m) => m.status === 'fulltime'),
              updatedAt: state.updatedAt,
              error: null,
            };
          }
          if (command === 'get_match_details') {
            if (args.force) stats.detailsForced++;
            if (details === 'error') throw new Error('Unavailable');
            if (details === 'pending') return new Promise(() => {});
            if (summary) return { ...summary, matchId: args.id };
            const match = state.matches.find((m) => m.id === args.id);
            const active = match && ['live', 'halftime', 'fulltime'].includes(match.status);
            return {
              matchId: args.id,
              updatedAt: new Date().toISOString(),
              stale: false,
              error: null,
              venue: match?.status === 'scheduled' ? 'Test Stadium' : null,
              events: active
                ? [
                    {
                      id: 'event-1',
                      minute: "15'",
                      period: 1,
                      seconds: 900,
                      kind: 'goal',
                      text: 'A goal is scored.',
                      teamId: match.home.id,
                    },
                  ]
                : [],
              statistics: active
                ? [
                    { teamId: match.home.id, name: 'totalShots', label: 'Shots', value: '3' },
                    { teamId: match.away.id, name: 'totalShots', label: 'Shots', value: '2' },
                  ]
                : [],
              players: active
                ? [
                    { teamId: match.home.id, name: 'Test Keeper', position: 'GK', starter: true },
                    ...Array.from({ length: 10 }, (_, i) => ({
                      teamId: match.home.id,
                      name: i === 9 ? 'Jordan Alexander West-Northumberland' : `Test Player ${i + 1}`,
                      position: 'FW',
                      starter: true,
                    })),
                    { teamId: match.away.id, name: 'Away Keeper', position: 'GK', starter: true },
                  ]
                : [],
            };
          }
          if (command === 'plugin:event|listen') {
            const id = ++nextListener;
            listeners.set(id, { event: String(args.event), handler: Number(args.handler) });
            return id;
          }
          if (command === 'plugin:event|unlisten') {
            listeners.delete(Number(args.eventId));
            return;
          }
          if (command === 'plugin:autostart|is_enabled') return false;
          return null;
        },
      };
      Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: internals, __MATCHRADAR_BRIDGE_STATS__: stats });
    },
    {
      snapshot: structuredClone(options.snapshot ?? mockSnapshot),
      details: options.details,
      summary: options.summary,
      notificationTarget: options.notificationTarget,
      failures: options.failures,
      savePersistsBeforeFail: options.savePersistsBeforeFail,
      saveDelayMs: options.saveDelayMs,
      resultsDelayMs: options.resultsDelayMs,
      loadDelayMs: options.loadDelayMs,
    },
  );
}

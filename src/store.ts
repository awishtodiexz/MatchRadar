import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings, Snapshot } from './types';
import { mockSnapshot } from './mock';

type Patch = Partial<Settings>;
type Store = { snapshot: Snapshot | null; loading: boolean; error: string | null; load: () => Promise<void>; refresh: () => Promise<void>; save: (patch: Patch) => Promise<void> };
const pending: Patch[] = [];
let queue: Promise<void> = Promise.resolve();
let loadVersion = 0;
const overlay = (settings: Settings) => Object.assign({}, settings, ...pending);
function withPending(snapshot: Snapshot): Snapshot {
  const settings = overlay(snapshot.settings);
  // Never relabel cached demo fixtures as live while the native mode save is pending.
  return settings.mock === snapshot.settings.mock ? {...snapshot, settings} : {
    ...snapshot, settings, matches: [], updatedAt: null, error: null, refreshing: true
  };
}
export const useApp = create<Store>((set, get) => ({
  snapshot: null, loading: true, error: null,
  load: async () => {
    const version = ++loadVersion;
    try {
      const snapshot = isTauri() ? await invoke<Snapshot>('get_snapshot') : get().snapshot ?? mockSnapshot;
      if (version === loadVersion) set({snapshot: withPending(snapshot), loading:false});
    } catch { if (version === loadVersion) set({loading:false, error:'Could not load the widget state.'}); }
  },
  refresh: async () => {
    try {
      if (isTauri()) { await invoke('refresh'); await get().load(); }
      else set(state => ({snapshot: state.snapshot ? {...state.snapshot, updatedAt:new Date().toISOString()} : null}));
    } catch { set({error:'Could not refresh matches.'}); }
  },
  save: (patch) => {
    ++loadVersion;
    pending.push(patch);
    set(state => ({error:null, snapshot: state.snapshot ? withPending(state.snapshot) : null}));
    const task = queue.then(async () => {
      try {
        const settings = get().snapshot?.settings;
        if (!settings) throw new Error('Settings unavailable');
        // Each request includes only the edits up to this point, never later queued edits.
        const base = {...settings};
        // Reconstruct from the last committed state maintained below.
        const next = {...(committed ?? base), ...pending[0]};
        if (isTauri()) await invoke('save_settings', {settings: next});
        committed = next;
        ++loadVersion;
        pending.shift();
        // Include edits queued while the native write was in flight, too.
        set(state => ({snapshot: state.snapshot ? {...state.snapshot, settings:overlay(next)} : null}));
      } catch {
        pending.shift();
        set(state => ({error:'Could not save settings. Please try again.',
          snapshot: state.snapshot && committed ? {...state.snapshot, settings:overlay(committed)} : state.snapshot}));
        if (isTauri()) await get().load();
      }
    });
    queue = task;
    return task;
  }
}));
let committed: Settings | null = null;
// Seed the committed base from snapshots when there are no local writes outstanding.
useApp.subscribe(state => { if (!pending.length && state.snapshot) committed = state.snapshot.settings; });

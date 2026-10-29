import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings, Snapshot } from './types';
import { mockSnapshot } from './mock';

type Patch = Partial<Settings>;
type Store = { snapshot: Snapshot | null; loading: boolean; error: string | null; load: () => Promise<void>; refresh: () => Promise<void>; save: (patch: Patch) => Promise<void> };
const pending: Patch[] = [];
let queue: Promise<void> = Promise.resolve();
let readSequence = 0;
let acceptedRead = 0;
let settingsRevision = 0;
let confirmed: Settings | null = null;
let feed: Snapshot | null = null;

function projected(): Snapshot | null {
  if (!feed || !confirmed) return null;
  const settings: Settings = Object.assign({}, confirmed, ...pending);
  // Keep the source mode with the feed, separate from optimistic settings.
  // A failed mode save can then restore its data without restoring stale scores.
  return settings.mock === feed.settings.mock ? {...feed, settings} : {
    ...feed, settings, matches: [], updatedAt: null, fixtureUpdatedAt: null,
    error: null, fixtureError: null, scoreError: null, partial: false, refreshing: true
  };
}

export const useApp = create<Store>((set, get) => ({
  snapshot: null, loading: true, error: null,
  load: async () => {
    const sequence = ++readSequence;
    const revision = settingsRevision;
    try {
      const snapshot = isTauri() ? await invoke<Snapshot>('get_snapshot') : get().snapshot ?? mockSnapshot;
      if (sequence <= acceptedRead) return;
      acceptedRead = sequence;
      feed = snapshot;
      // A read started before a save acknowledgement can contain old preferences
      // and still carry fresh matches/errors. Accept its data, not its settings.
      if (revision === settingsRevision || !confirmed) confirmed = snapshot.settings;
      set({snapshot: projected(), loading:false});
    } catch {
      if (sequence > acceptedRead) set({loading:false, error:'Could not load the widget state.'});
    }
  },
  refresh: async () => {
    try {
      if (isTauri()) { await invoke('refresh'); await get().load(); }
      else {
        if (feed) feed = {...feed, updatedAt:new Date().toISOString()};
        set({snapshot:projected()});
      }
    } catch { set({error:'Could not refresh matches.'}); }
  },
  save: (patch) => {
    pending.push(patch);
    set({error:null, snapshot:projected()});
    const task = queue.then(async () => {
      try {
        if (!confirmed) throw new Error('Settings unavailable');
        const next: Settings = {...confirmed, ...pending[0]};
        // Rust returns persisted, normalized preferences; never promote the payload
        // to authoritative state or copy a whole old snapshot on completion.
        const saved = isTauri() ? await invoke<Settings>('save_settings', {settings:next}) : next;
        confirmed = saved;
        ++settingsRevision;
        pending.shift();
        set({snapshot:projected()});
      } catch {
        pending.shift();
        set({snapshot:projected(), error:'Could not save settings. Please try again.'});
        // A transport/event error can happen after Rust persisted the write.
        // Reconcile locally without holding up later queued edits or polling ESPN.
        if (isTauri()) void get().load();
      }
    });
    queue = task;
    return task;
  }
}));

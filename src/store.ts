import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings, Snapshot } from './types';
import { mockSnapshot } from './mock';
import { progressDemo } from './demoScenario';

type Patch = Partial<Settings>;
type Store = { demoStep:number; demoControl:(action:'advance'|'reset')=>void; snapshot: Snapshot | null; loading: boolean; error: string | null; load: () => Promise<void>; refresh: () => Promise<void>; save: (patch: Patch) => Promise<void> };
const pending: Patch[] = [];
let queue: Promise<void> = Promise.resolve();
let readSequence = 0;
let acceptedRead = 0;
let settingsRevision = 0;
let confirmed: Settings | null = null;
let feed: Snapshot | null = null;
let demoStep=0;
const loadError = 'Could not load the widget state.';
const refreshError = 'Could not refresh matches.';
const recoveredError = (error:string|null) => error===loadError||error===refreshError?null:error;

function projected(): Snapshot | null {
  if (!feed || !confirmed) return null;
  const settings: Settings = Object.assign({}, confirmed, ...pending);
  // Keep the source mode with the feed, separate from optimistic settings.
  // A failed mode save can then restore its data without restoring stale scores.
  return settings.mock === feed.settings.mock ? {...feed, settings, matches:settings.mock?progressDemo(feed.matches,demoStep):feed.matches} : {
    ...feed, settings, matches: [], updatedAt: null, fixtureUpdatedAt: null,
    error: null, fixtureError: null, scoreError: null, partial: false, refreshing: true
  };
}

export const useApp = create<Store>((set, get) => ({
  snapshot: null, loading: true, error: null, demoStep:0,
  demoControl: action => {
    if(!get().snapshot?.settings.mock || !feed?.settings.mock)return;
    demoStep=action==='reset'?0:Math.min(4,demoStep+1);
    set({demoStep,snapshot:projected()});
  },
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
      set(state=>({snapshot: projected(), loading:false, error:recoveredError(state.error)}));
    } catch {
      if (sequence > acceptedRead) set(state=>({loading:false, error:state.error??loadError}));
    }
  },
  refresh: async () => {
    try {
      if (isTauri()) { await invoke('refresh'); await get().load(); }
      else {
        if (feed) feed = {...feed, updatedAt:new Date().toISOString()};
        set(state=>({snapshot:projected(),error:recoveredError(state.error)}));
      }
    } catch { set(state=>({error:state.error??refreshError})); }
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
        if(!saved.mock){demoStep=0;set({demoStep:0});}
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

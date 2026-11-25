import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings, Snapshot } from './types';

type Patch = Partial<Settings>;
type Store = {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  opacityPreview: number | null;
  setOpacityPreview: (value: number | null) => void;
  load: () => Promise<void>;
  refresh: () => Promise<boolean>;
  save: (patch: Patch) => Promise<boolean>;
};
const pending: Patch[] = [];
let queue: Promise<void> = Promise.resolve();
let readSequence = 0;
let acceptedRead = 0;
let settingsRevision = 0;
let confirmed: Settings | null = null;
// A transport error can hide a write Rust already persisted; until a read
// dispatched after the failure lands, `confirmed` is a guess and must not be
// the base of another write. `reconcileAfter` pins that ordering.
let settingsUnverified = false;
let reconcileAfter = 0;
let reconcile: Promise<void> | null = null;
const startReconcile = (load: () => Promise<void>) => {
  reconcileAfter = readSequence;
  const attempt = load().catch(() => {});
  reconcile = attempt;
  void attempt.finally(() => {
    if (reconcile === attempt) reconcile = null;
  });
  return attempt;
};
let feed: Snapshot | null = null;
const loadError = 'Could not load the widget state.';
const refreshError = 'Could not refresh matches.';
const recoveredError = (error: string | null) => (error === loadError || error === refreshError ? null : error);
// Paint hints only; Rust remains the authoritative preference store. Without
// them the shell would boot dark and unreduced on every launch, then flip when
// the snapshot lands.
const rememberAppearance = (settings: Settings) => {
  try {
    localStorage.setItem('matchradar.theme', settings.theme);
    localStorage.setItem('matchradar.reducedMotion', String(settings.reducedMotion));
  } catch {
    /* Storage can be unavailable. */
  }
};

function projected(): Snapshot | null {
  if (!feed || !confirmed) return null;
  const settings: Settings = Object.assign({}, confirmed, ...pending);
  return { ...feed, settings };
}

export const useApp = create<Store>((set, get) => ({
  snapshot: null,
  loading: true,
  error: null,
  opacityPreview: null,
  setOpacityPreview: (value) => set({ opacityPreview: value }),
  load: async () => {
    const sequence = ++readSequence;
    const revision = settingsRevision;
    try {
      const snapshot = isTauri() ? await invoke<Snapshot>('get_snapshot') : get().snapshot;
      if (!snapshot) throw new Error('Desktop app required');
      if (sequence <= acceptedRead) return;
      acceptedRead = sequence;
      feed = snapshot;
      // A read started before a save acknowledgement can contain old preferences
      // and still carry fresh matches/errors. Accept its data, not its settings.
      const postFailure = sequence > reconcileAfter;
      if (revision === settingsRevision || !confirmed || (settingsUnverified && postFailure)) {
        confirmed = snapshot.settings;
        if (postFailure) settingsUnverified = false;
        rememberAppearance(confirmed);
      }
      set((state) => ({ snapshot: projected(), loading: false, error: recoveredError(state.error) }));
    } catch {
      if (sequence > acceptedRead)
        set((state) => ({
          loading: false,
          error: state.error ?? (isTauri() ? loadError : 'Match data is available in the desktop app.'),
        }));
    }
  },
  refresh: async () => {
    try {
      if (isTauri()) {
        await invoke('refresh');
        await get().load();
      } else {
        if (feed) feed = { ...feed, updatedAt: new Date().toISOString() };
        set((state) => ({ snapshot: projected(), error: recoveredError(state.error) }));
      }
      return true;
    } catch {
      set((state) => ({ error: state.error ?? refreshError }));
      return false;
    }
  },
  save: (patch) => {
    pending.push(patch);
    set({ error: null, snapshot: projected() });
    const task = queue.then(async () => {
      try {
        if (!confirmed) throw new Error('Settings unavailable');
        if (isTauri() && settingsUnverified) {
          // The previous write may have landed on disk anyway; reconcile before
          // merging or this save can overwrite the change that did persist.
          await (reconcile ?? startReconcile(() => get().load()));
          if (settingsUnverified) await startReconcile(() => get().load());
          if (settingsUnverified) throw new Error('Could not reconcile settings');
        }
        const next: Settings = { ...confirmed, ...pending[0] };
        // Rust returns persisted, normalized preferences; never promote the payload
        // to authoritative state or copy a whole old snapshot on completion.
        const saved = isTauri() ? await invoke<Settings>('save_settings', { settings: next }) : next;
        confirmed = saved;
        rememberAppearance(saved);
        ++settingsRevision;
        pending.shift();
        set({ snapshot: projected() });
        return true;
      } catch {
        pending.shift();
        set({ snapshot: projected(), error: 'Could not save settings. Please try again.' });
        // A transport/event error can happen after Rust persisted the write.
        // Reconcile locally; a read dispatched now postdates the write handler.
        if (isTauri()) {
          settingsUnverified = true;
          void startReconcile(() => get().load());
        }
        return false;
      }
    });
    queue = task.then(() => {});
    return task;
  },
}));

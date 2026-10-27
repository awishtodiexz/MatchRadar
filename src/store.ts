import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings, Snapshot } from './types';
import { mockSnapshot } from './mock';
type Store = { snapshot: Snapshot | null; loading: boolean; load: () => Promise<void>; refresh: () => Promise<void>; save: (settings: Settings) => Promise<void> };
export const useApp = create<Store>((set, get) => ({
  snapshot: null, loading: true,
  load: async () => { try { const snapshot = isTauri() ? await invoke<Snapshot>('get_snapshot') : mockSnapshot; set({snapshot, loading:false}); } catch { set({loading:false}); } },
  refresh: async () => { if (isTauri()) { await invoke('refresh'); await get().load(); } else set({snapshot:{...mockSnapshot,updatedAt:new Date().toISOString()}}); },
  save: async (settings) => { if (isTauri()) { await invoke('save_settings', { settings }); await get().load(); } else set(state => ({snapshot: state.snapshot ? {...state.snapshot, settings} : null})); }
}));

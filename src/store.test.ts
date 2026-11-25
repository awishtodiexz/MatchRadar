import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSnapshot } from './test-fixtures/fixtures';
import type { Settings, Snapshot } from './types';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let store: (typeof import('./store'))['useApp'];
let reads: ReturnType<typeof deferred<Snapshot>>[];
let writes: { settings: Settings; task: ReturnType<typeof deferred<Settings>> }[];
const initial = (): Snapshot =>
  structuredClone({ ...mockSnapshot, updatedAt: '2026-10-28T12:00:00Z', settings: { ...mockSnapshot.settings } });
const fresh = (): Snapshot => ({
  ...initial(),
  matches: [{ ...mockSnapshot.matches[0], homeScore: 4, scoreStale: true }],
  updatedAt: '2026-10-28T12:01:00Z',
  fixtureUpdatedAt: '2026-10-28T12:02:00Z',
  scoreError: 'Daily scores unavailable',
  partial: true,
  error: 'Partial feed failure',
  refreshing: true,
});

beforeEach(async () => {
  vi.resetModules();
  reads = [];
  writes = [];
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation((command: string, args?: { settings: Settings }) => {
    if (command === 'get_snapshot') {
      const task = deferred<Snapshot>();
      reads.push(task);
      return task.promise;
    }
    if (command === 'save_settings' && args) {
      const task = deferred<Settings>();
      writes.push({ settings: args.settings, task });
      return task.promise;
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
  store = (await import('./store')).useApp;
  const load = store.getState().load();
  reads[0].resolve(initial());
  await load;
  reads = [];
});

describe('native snapshot and preference ordering', () => {
  it('persists system theme without changing the following filter', async () => {
    const saving = store.getState().save({ theme: 'system' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].settings).toMatchObject({ theme: 'system', followedOnly: false });
    writes[0].task.resolve(writes[0].settings);
    await saving;
    expect(store.getState().snapshot?.settings).toMatchObject({ theme: 'system', followedOnly: false });
  });
  it('clears an obsolete read error on a later successful snapshot without hiding save errors', async () => {
    const failed = store.getState().load();
    reads[0].reject(new Error('IPC unavailable'));
    await failed;
    expect(store.getState().error).toBe('Could not load the widget state.');
    const recovered = store.getState().load();
    reads[1].resolve(fresh());
    await recovered;
    expect(store.getState().error).toBeNull();
    store.setState({ error: 'Could not save settings. Please try again.' });
    const again = store.getState().load();
    reads[2].resolve(fresh());
    await again;
    expect(store.getState().error).toBe('Could not save settings. Please try again.');
  });

  it('clears a refresh failure after a successful refresh/read and makes no extra requests', async () => {
    await store.getState().refresh(); // The controlled bridge rejects unknown commands.
    expect(store.getState().error).toBe('Could not refresh matches.');
    bridge.invoke.mockImplementationOnce(() => Promise.resolve());
    const recovered = store.getState().refresh();
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    reads[0].resolve(fresh());
    await recovered;
    expect(store.getState().error).toBeNull();
    expect(bridge.invoke.mock.calls.filter(([name]) => name === 'refresh')).toHaveLength(2);
  });
  it('F02: accepts a fresh event snapshot finishing after a cosmetic save', async () => {
    const save = store.getState().save({ opacity: 80 });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const eventLoad = store.getState().load();
    writes[0].task.resolve(writes[0].settings);
    await save;
    reads[0].resolve(fresh());
    await eventLoad;
    expect(store.getState().snapshot).toMatchObject({
      matches: [{ homeScore: 4, scoreStale: true }],
      updatedAt: '2026-10-28T12:01:00Z',
      fixtureUpdatedAt: '2026-10-28T12:02:00Z',
      scoreError: 'Daily scores unavailable',
      partial: true,
      error: 'Partial feed failure',
      refreshing: true,
      settings: { opacity: 80 },
    });
  });

  it('preserves data arriving before the save acknowledgement', async () => {
    const save = store.getState().save({ theme: 'light' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const eventLoad = store.getState().load();
    reads[0].resolve(fresh());
    await eventLoad;
    expect(store.getState().snapshot?.settings.theme).toBe('light');
    writes[0].task.resolve(writes[0].settings);
    await save;
    expect(store.getState().snapshot).toMatchObject({
      matches: [{ homeScore: 4 }],
      error: 'Partial feed failure',
      settings: { theme: 'light' },
    });
  });

  it('ignores an older read completing after a newer accepted read', async () => {
    const older = store.getState().load();
    const newer = store.getState().load();
    reads[1].resolve(fresh());
    await newer;
    reads[0].resolve(initial());
    await older;
    expect(store.getState().snapshot).toMatchObject({
      matches: [{ homeScore: 4 }],
      error: 'Partial feed failure',
      refreshing: true,
    });
  });

  it('serializes rapid patches and keeps all later edits optimistic', async () => {
    const first = store.getState().save({ opacity: 80 });
    const second = store.getState().save({ opacity: 75 });
    const third = store.getState().save({ alwaysOnTop: false, theme: 'light' });
    expect(store.getState().snapshot?.settings).toMatchObject({ opacity: 75, alwaysOnTop: false, theme: 'light' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].settings.opacity).toBe(80);
    writes[0].task.resolve(writes[0].settings);
    await first;
    expect(store.getState().snapshot?.settings.opacity).toBe(75);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    writes[1].task.resolve(writes[1].settings);
    await second;
    await vi.waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].settings).toMatchObject({ opacity: 75, alwaysOnTop: false, theme: 'light' });
    writes[2].task.resolve(writes[2].settings);
    await third;
    expect(bridge.invoke.mock.calls.map(([name]) => name)).not.toContain('refresh');
  });

  it('rolls back failed preferences while retaining fresh data and later edits', async () => {
    const failed = store.getState().save({ alwaysOnTop: false });
    const later = store.getState().save({ theme: 'light' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const eventLoad = store.getState().load();
    reads[0].resolve(fresh());
    await eventLoad;
    writes[0].task.reject(new Error('Disk full'));
    expect(await failed).toBe(false);
    expect(store.getState().snapshot).toMatchObject({
      matches: [{ homeScore: 4 }],
      updatedAt: '2026-10-28T12:01:00Z',
      error: 'Partial feed failure',
      settings: { alwaysOnTop: true, theme: 'light' },
    });
    // The queued save waits on the reconcile read the failure dispatched: a
    // transport error can hide a persisted write, so merging on the stale
    // confirmed state could overwrite the change that did persist (R4-FE-01).
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    reads[1].resolve({ ...fresh(), settings: { ...initial().settings, alwaysOnTop: false } });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].settings.alwaysOnTop).toBe(false);
    writes[1].task.resolve(writes[1].settings);
    expect(await later).toBe(true);
    await vi.waitFor(() => expect(store.getState().snapshot?.settings.theme).toBe('light'));
    expect(store.getState().error).toMatch(/Could not save/);
  });

  it('F14: uses normalized settings without allowing a pre-save snapshot to restore rejected alerts', async () => {
    const submitted = { invalid: { enabled: true, expiresAt: 'expired' } };
    const save = store.getState().save({ matchAlerts: submitted, opacity: 60 });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const oldSettingsLoad = store.getState().load();
    writes[0].task.resolve({ ...writes[0].settings, matchAlerts: {}, opacity: 70 });
    await save;
    reads[0].resolve({ ...fresh(), settings: { ...initial().settings, matchAlerts: submitted } });
    await oldSettingsLoad;
    expect(store.getState().snapshot).toMatchObject({
      matches: [{ homeScore: 4 }],
      settings: { matchAlerts: {}, opacity: 70 },
    });
    expect(store.getState().snapshot?.settings.matchAlerts).toEqual({});
    const next = store.getState().save({ compact: true });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].settings).toMatchObject({ matchAlerts: {}, opacity: 70, compact: true });
    writes[1].task.resolve(writes[1].settings);
    await next;
  });

  it('keeps a queued edit based on the first acknowledged write when a stale read lands between them', async () => {
    const first = store.getState().save({ opacity: 80 });
    const second = store.getState().save({ theme: 'light' });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const staleRead = store.getState().load();
    // Rust normalizes the submitted opacity; the later edit must build on that value.
    writes[0].task.resolve({ ...writes[0].settings, opacity: 85 });
    await first;
    reads[0].resolve(initial());
    await staleRead;
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].settings).toMatchObject({ opacity: 85, theme: 'light' });
    writes[1].task.resolve(writes[1].settings);
    await second;
    expect(store.getState().snapshot?.settings).toMatchObject({ opacity: 85, theme: 'light' });
    expect(store.getState().snapshot?.matches).toHaveLength(mockSnapshot.matches.length);
  });
});

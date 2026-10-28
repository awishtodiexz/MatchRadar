// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockSnapshot } from './mock';
import { useApp } from './store';
import App from './App';

const bridge = vi.hoisted(() => ({ native: false, invoke: vi.fn(), minimize: vi.fn(), hide: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ minimize: bridge.minimize, hide: bridge.hide }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn().mockResolvedValue(false), enable: vi.fn(), disable: vi.fn() }));
beforeEach(() => { bridge.native = false; bridge.invoke.mockReset(); bridge.minimize.mockReset(); useApp.setState({snapshot: {...mockSnapshot, settings: {...mockSnapshot.settings}}, loading: false, error: null}); });
afterEach(cleanup);
describe('widget controls', () => {
 it('uses native minimize and leaves compact mode in Appearance', async () => {
  bridge.native = true; bridge.minimize.mockResolvedValue(undefined); bridge.invoke.mockImplementation((command: string) => command === 'get_snapshot' ? Promise.resolve(mockSnapshot) : Promise.resolve());
  render(<App/>); fireEvent.click(screen.getByRole('button', {name:'Minimize widget'}));
  expect(bridge.minimize).toHaveBeenCalledOnce(); expect(useApp.getState().snapshot?.settings.compact).toBe(false);
  fireEvent.click(screen.getByRole('button', {name:'Settings'})); fireEvent.click(screen.getByText('Appearance'));
  expect(screen.getByLabelText(/Compact view/)).toBeTruthy();
 });
 it('synchronizes footer toggles with settings and preserves update time when appearance changes', async () => {
  const updated = useApp.getState().snapshot?.updatedAt;
  render(<App/>); fireEvent.click(screen.getByRole('button', {name:'Following only'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'Following only'}).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', {name:'Always on top'})); fireEvent.click(screen.getByRole('button', {name:'Settings'}));
  expect((screen.getByRole('checkbox', {name:/Following only/}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText('Appearance'));
  expect((screen.getByRole('checkbox', {name:/Always on top/}) as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText(/Panel opacity/), {target:{value:'70'}});
  fireEvent.change(screen.getByLabelText('Theme'), {target:{value:'light'}});
  await waitFor(() => expect(useApp.getState().snapshot?.settings.theme).toBe('light'));
  expect(useApp.getState().snapshot?.updatedAt).toBe(updated);
  expect(document.querySelector('.shell')?.classList.contains('theme-light')).toBe(true);
 });
 it('serializes native patches while an older snapshot races the saves', async () => {
  bridge.native = true;
  let releaseSave: (() => void) | undefined;
  let releaseLoad: ((value: typeof mockSnapshot) => void) | undefined;
  bridge.invoke.mockImplementation((command: string) => {
   if (command === 'save_settings' && !releaseSave) return new Promise<void>(resolve => { releaseSave = resolve; });
   if (command === 'get_snapshot') return new Promise(resolve => { releaseLoad = resolve; });
   return Promise.resolve();
  });
  const first = useApp.getState().save({alwaysOnTop:false});
  const second = useApp.getState().save({theme:'light', opacity:70});
  await waitFor(() => expect(releaseSave).toBeDefined());
  const stale = useApp.getState().load();
  releaseSave?.(); await first; await second;
  releaseLoad?.(mockSnapshot); await stale;
  const calls = bridge.invoke.mock.calls.filter(([command]) => command === 'save_settings');
  expect(calls).toHaveLength(2);
  expect(calls[1][1].settings).toMatchObject({alwaysOnTop:false, theme:'light', opacity:70});
  expect(useApp.getState().snapshot?.settings).toMatchObject({alwaysOnTop:false, theme:'light', opacity:70});
 });
 it('retries a trusted crest once before showing initials', async () => {
  render(<App/>); const image = document.querySelector('img') as HTMLImageElement;
  expect(image.src).toContain('/500-dark/'); fireEvent.error(image);
  expect(image.src).toContain('/500/'); fireEvent.error(image);
  await waitFor(() => expect(image.isConnected).toBe(false));
  expect(screen.getAllByText('ARS').length).toBeGreaterThan(0);
 });
 it('keeps a later optimistic preference visible when an earlier save finishes', async () => {
  bridge.native = true;
  const releases: Array<() => void> = [];
  bridge.invoke.mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)));
  const first = useApp.getState().save({alwaysOnTop:false});
  await waitFor(() => expect(releases).toHaveLength(1));
  const second = useApp.getState().save({theme:'light'});
  releases[0](); await first;
  expect(useApp.getState().snapshot?.settings.theme).toBe('light');
  await waitFor(() => expect(releases).toHaveLength(2));
  releases[1](); await second;
 });
 it('persists compact and theme through the native bridge without requesting refresh', async () => {
  bridge.native = true;
  let persisted = {...mockSnapshot, settings:{...mockSnapshot.settings}};
  bridge.invoke.mockImplementation((command: string, args?: {settings: typeof persisted.settings}) => {
   if (command === 'save_settings' && args) persisted = {...persisted, settings:args.settings};
   return Promise.resolve(command === 'get_snapshot' ? persisted : undefined);
  });
  render(<App/>);
  fireEvent.click(screen.getByRole('button', {name:'Settings'}));
  fireEvent.click(screen.getByText('Appearance'));
  fireEvent.click(screen.getByRole('checkbox', {name:/Compact view/}));
  fireEvent.change(screen.getByLabelText('Theme'), {target:{value:'light'}});
  await waitFor(() => expect(persisted.settings).toMatchObject({compact:true, theme:'light'}));
  await useApp.getState().load();
  expect(document.querySelector('.shell')?.classList.contains('compact-view')).toBe(true);
  expect(useApp.getState().snapshot?.settings).toMatchObject({compact:true, theme:'light'});
  expect(persisted.updatedAt).toBe(mockSnapshot.updatedAt);
  expect(bridge.invoke.mock.calls.some(([command]) => command === 'refresh')).toBe(false);
 });
 it('rolls back a failed native save and keeps a later unrelated edit', async () => {
  bridge.native = true;
  let persisted = {...mockSnapshot, settings:{...mockSnapshot.settings}};
  bridge.invoke.mockImplementation((command: string, args?: {settings: typeof persisted.settings}) => {
   if (command === 'get_snapshot') return Promise.resolve(persisted);
   if (args?.settings.alwaysOnTop === false) return Promise.reject(new Error('Disk unavailable'));
   if (args) persisted = {...persisted, settings:args.settings};
   return Promise.resolve();
  });
  const pin = useApp.getState().save({alwaysOnTop:false});
  const theme = useApp.getState().save({theme:'light'});
  await pin; await theme;
  expect(persisted.settings).toMatchObject({alwaysOnTop:true, theme:'light'});
  expect(useApp.getState().snapshot?.settings).toMatchObject({alwaysOnTop:true, theme:'light'});
  expect(useApp.getState().error).toMatch(/Could not save/);
 });
 it('does not relabel demo fixtures as live during a mode save or stale snapshot load', async () => {
  bridge.native = true;
  let releaseSave: (() => void) | undefined;
  bridge.invoke.mockImplementation((command: string) => command === 'get_snapshot'
   ? Promise.resolve(mockSnapshot)
   : new Promise<void>(resolve => {releaseSave=resolve;}));
  const save = useApp.getState().save({mock:false});
  expect(useApp.getState().snapshot?.matches).toEqual([]);
  await useApp.getState().load();
  expect(useApp.getState().snapshot?.settings.mock).toBe(false);
  expect(useApp.getState().snapshot?.matches).toEqual([]);
  expect(useApp.getState().snapshot?.updatedAt).toBeNull();
  releaseSave?.(); await save;
 });
});

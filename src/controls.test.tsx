// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockSnapshot } from './demo/fixtures';
import { useApp } from './store';
import App from './App';
import type { Settings } from './types';
import { isEnabled } from '@tauri-apps/plugin-autostart';

const bridge = vi.hoisted(() => ({ native: false, invoke: vi.fn(), minimize: vi.fn(), hide: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ minimize: bridge.minimize, hide: bridge.hide }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: vi.fn().mockResolvedValue(false), enable: vi.fn(), disable: vi.fn() }));
beforeEach(async () => {
 bridge.native = false; bridge.invoke.mockReset(); bridge.minimize.mockReset();
 useApp.setState({snapshot: {...mockSnapshot, settings: {...mockSnapshot.settings}}, loading: false, error: null});
 await useApp.getState().load();
});
afterEach(cleanup);
describe('widget controls', () => {
 it('keeps a Windows startup read failure visible when opening the App tab',async()=>{
  bridge.native=true;
  vi.mocked(isEnabled).mockRejectedValueOnce(new Error('Startup unavailable'));
  bridge.invoke.mockImplementation((command:string)=>Promise.resolve(command==='get_snapshot'?mockSnapshot:undefined));
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  await waitFor(()=>expect(isEnabled).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('tab',{name:'App'}));
  expect(await screen.findByText('Could not read the Windows startup setting. Reopen Settings to try again.')).toBeTruthy();
  expect(screen.getByRole('checkbox',{name:'Launch with Windows'}).hasAttribute('disabled')).toBe(true);
 });
 it('shows partial fixture success and saved live scores without claiming they were freshly confirmed', async () => {
  bridge.native=true;
  const snapshot={...mockSnapshot,settings:{...mockSnapshot.settings,mock:false},partial:true,error:'Scores: HTTP 500',scoreError:'HTTP 500',updatedAt:'2026-10-28T11:00:00Z',fixtureUpdatedAt:'2026-10-28T12:00:00Z',matches:mockSnapshot.matches.map(m=>({...m,scoreStale:m.status==='live'||m.status==='halftime'}))};
  bridge.invoke.mockImplementation((command: string)=>Promise.resolve(command==='get_snapshot'?snapshot:undefined));
  render(<App/>);
  expect(await screen.findByText('Partial update · some data may be stale')).toBeTruthy();
  expect(screen.getByText('Saved · 67′').classList.contains('live-text')).toBe(false);
  expect(screen.getByRole('heading',{name:/SAVED LIVE SCORES/})).toBeTruthy();
  expect(screen.getByRole('heading',{name:/SAVED LIVE SCORES/}).classList.contains('live-group')).toBe(false);
  expect(screen.getByText('SAVED LIVE',{exact:true})).toBeTruthy();
  expect(document.querySelector('footer')?.textContent).toContain('PARTIAL · SCORES SAVED');
  expect(bridge.invoke.mock.calls.every(([command])=>command==='get_snapshot')).toBe(true);
 });
 it('round-trips a match subscription through the native settings bridge', async () => {
  bridge.native = true;
  let persisted = {...mockSnapshot, settings:{...mockSnapshot.settings, matchAlerts:{}}};
  bridge.invoke.mockImplementation((command: string, args?: {settings: typeof mockSnapshot.settings}) => {
   if (command === 'save_settings' && args) persisted = {...persisted, settings:args.settings};
   return Promise.resolve(command === 'get_snapshot' ? persisted : args?.settings);
  });
  render(<App/>);
  fireEvent.click(screen.getByRole('button', {name:'Enable all alerts (using team settings): Arsenal versus Chelsea'}));
  await waitFor(() => expect(persisted.settings.matchAlerts).toHaveProperty('demo-1'));
  await useApp.getState().load();
  expect(screen.getByRole('button', {name:'Mute match alerts (all alerts on): Arsenal versus Chelsea'}).getAttribute('aria-pressed')).toBe('true');
  expect(bridge.invoke.mock.calls.some(([command]) => command === 'refresh')).toBe(false);
 });
 it('uses a separate match bell, persists its override, and can mute team alerts', async () => {
  render(<App/>);
  const bell = screen.getByRole('button', {name:'Enable all alerts (using team settings): Arsenal versus Chelsea'});
  expect(bell.closest('button button')).toBeNull();
  fireEvent.click(bell);
  await waitFor(() => expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(true));
  expect(screen.queryByText('Match details')).toBeNull();
  const mute = screen.getByRole('button', {name:'Mute match alerts (all alerts on): Arsenal versus Chelsea'});
  expect(mute.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(mute);
  await waitFor(() => expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(false));
  await useApp.getState().load();
  expect(screen.getByRole('button', {name:'Enable all alerts (match muted): Arsenal versus Chelsea'}).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('heading', {name:/LIVE NOW/})).toBeTruthy();
  expect(screen.getByText(/approximately the next 14 days/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Settings'}));
  fireEvent.click(screen.getByText('Alerts', {exact:true}));
  fireEvent.click(screen.getByText('Reset match bells to team defaults'));
  await waitFor(() => expect(useApp.getState().snapshot?.settings.matchAlerts).toEqual({}));
 });
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
  bridge.invoke.mockImplementation((command: string, args?: {settings: Settings}) => {
   if (command === 'save_settings' && args && !releaseSave) return new Promise<Settings>(resolve => { releaseSave = () => resolve(args.settings); });
   if (command === 'get_snapshot') return new Promise(resolve => { releaseLoad = resolve; });
   return Promise.resolve(args?.settings);
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
  bridge.invoke.mockImplementation((_command: string, args: {settings: Settings}) => new Promise<Settings>(resolve => releases.push(() => resolve(args.settings))));
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
   return Promise.resolve(command === 'get_snapshot' ? persisted : args?.settings);
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
   return Promise.resolve(args?.settings);
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
  bridge.invoke.mockImplementation((command: string, args?: {settings: Settings}) => {
   if (command === 'get_snapshot') return Promise.resolve(mockSnapshot);
   if (!args) throw new Error('Missing settings payload');
   return new Promise<Settings>(resolve => {releaseSave=()=>resolve(args.settings);});
  });
  const save = useApp.getState().save({mock:false});
  expect(useApp.getState().snapshot?.matches).toEqual([]);
  await useApp.getState().load();
  expect(useApp.getState().snapshot?.settings.mock).toBe(false);
  expect(useApp.getState().snapshot?.matches).toEqual([]);
  expect(useApp.getState().snapshot?.updatedAt).toBeNull();
  releaseSave?.(); await save;
 });
});

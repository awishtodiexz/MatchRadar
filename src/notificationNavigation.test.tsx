// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { useApp } from './store';
import { mockSnapshot } from './test-fixtures/fixtures';
import { useNotificationNavigation } from './useNotificationNavigation';
import type { NotificationTarget } from './useNotificationNavigation';

const bridge=vi.hoisted(()=>({invoke:vi.fn(),handlers:new Map<string,()=>void>(),stop:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:bridge.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(event:string,handler:()=>void)=>{bridge.handlers.set(event,handler);return bridge.stop;})}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:vi.fn()}));
vi.mock('@tauri-apps/plugin-autostart',()=>({isEnabled:vi.fn().mockResolvedValue(false),enable:vi.fn(),disable:vi.fn()}));
let pending:NotificationTarget|null;
const fixture=mockSnapshot.matches[0];
beforeEach(()=>{
 pending=null;bridge.handlers.clear();bridge.invoke.mockReset();bridge.stop.mockReset();
 useApp.setState({snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,competitionView:'championsLeague',favorites:[],followedOnly:true}},loading:false,error:null});
 bridge.invoke.mockImplementation(async(command:string,args?:{requestId:number})=>{
   if(command==='get_snapshot') return useApp.getState().snapshot;
   if(command==='get_notification_target') return pending;
   if(command==='acknowledge_notification_target') {if(pending?.requestId===args?.requestId)pending=null;return;}
   if(command==='get_match_details') return {matchId:fixture.id,venue:null,updatedAt:'2026-11-08T15:00:00Z',events:[],players:[],statistics:[],error:null,stale:false};
 });
});
afterEach(cleanup);

it('opens a startup notification destination despite competition and following filters',async()=>{
 pending={requestId:1,matchId:fixture.id,match:fixture};
 render(<App/>);
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Match details'})).toBeTruthy());
 expect(screen.getByText(fixture.home.name)).toBeTruthy();
 expect(useApp.getState().snapshot?.settings.competitionView).toBe('championsLeague');
 expect(useApp.getState().snapshot?.settings.followedOnly).toBe(true);
 await waitFor(()=>expect(pending).toBeNull());
 expect(bridge.invoke).toHaveBeenCalledWith('acknowledge_notification_target',{requestId:1});
});
it('handles a click while Settings is open and navigates to the notification match',async()=>{
 render(<App/>);
 await waitFor(()=>expect(bridge.invoke).toHaveBeenCalledWith('get_notification_target'));
 fireEvent.click(screen.getByRole('button',{name:'Settings'}));
 pending={requestId:2,matchId:fixture.id,match:fixture};
 act(()=>bridge.handlers.get('notification-opened')?.());
 await waitFor(()=>expect(screen.getByRole('heading',{name:'Match details'})).toBeTruthy());
 expect(screen.getByText(fixture.away.name)).toBeTruthy();
});
it('explains an expired destination instead of opening a different match',async()=>{
 pending={requestId:3,matchId:'missing',match:null};render(<App/>);
 expect(await screen.findByText(/notification’s match is no longer/)).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Match details'})).toBeNull();
 await waitFor(()=>expect(pending).toBeNull());
});
it('does not acknowledge a target when the webview unmounts during its read',async()=>{
 let resolve:(target:NotificationTarget)=>void=()=>{};
 bridge.invoke.mockImplementation(()=>new Promise<NotificationTarget>(done=>{resolve=done;}));
 const onOpen=vi.fn();const view=renderHook(()=>useNotificationNavigation(true,onOpen));
 await waitFor(()=>expect(bridge.invoke).toHaveBeenCalledWith('get_notification_target'));
 view.unmount();
 await act(async()=>resolve({requestId:4,matchId:fixture.id,match:fixture}));
 expect(onOpen).not.toHaveBeenCalled();
 expect(bridge.invoke).not.toHaveBeenCalledWith('acknowledge_notification_target',expect.anything());
 expect(bridge.stop).toHaveBeenCalled();
});
it('consumes a newer click arriving while the previous acknowledgement is pending',async()=>{
 let release:()=>void=()=>{};let reads=0;
 bridge.invoke.mockImplementation(async(command:string)=>{
   if(command==='get_notification_target') return {requestId:++reads,matchId:fixture.id,match:fixture};
   if(command==='acknowledge_notification_target'&&reads===1) await new Promise<void>(done=>{release=done;});
 });
 const onOpen=vi.fn();renderHook(()=>useNotificationNavigation(true,onOpen));
 await waitFor(()=>expect(onOpen).toHaveBeenCalledTimes(1));
 act(()=>bridge.handlers.get('notification-opened')?.());
 await act(async()=>release());
 await waitFor(()=>expect(onOpen).toHaveBeenCalledTimes(2));
 expect(onOpen.mock.calls[1][0].requestId).toBe(2);
});

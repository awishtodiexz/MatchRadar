import type { Page } from '@playwright/test';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { Snapshot } from '../../src/types';
import type { MatchSummary } from '../../src/useMatchSummary';
import type { NotificationTarget } from '../../src/useNotificationNavigation';

// Test-only desktop bridge. It is injected by Playwright and is never bundled.
export async function installBridge(page: Page, options: {snapshot?:Snapshot; details?:'error'|'pending';summary?:MatchSummary;notificationTarget?:NotificationTarget} = {}) {
  await page.addInitScript(({snapshot,details,summary,notificationTarget}) => {
    let state = snapshot;
    let target=notificationTarget??null;
    let requestId=target?.requestId??0;
    let nextCallback=0,nextListener=0;
    const callbacks=new Map<number,(event:unknown)=>void>();
    const listeners=new Map<number,{event:string;handler:number}>();
    window.addEventListener('test:notification-click',event=>{
      const matchId=(event as CustomEvent<string|null>).detail;
      target={requestId:++requestId,matchId,match:state.matches.find(match=>match.id===matchId)??null};
      for(const [id,listener] of listeners) if(listener.event==='notification-opened') callbacks.get(listener.handler)?.({event:listener.event,id,payload:null});
    });
    const internals = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: (callback:(event:unknown)=>void) => {const id=++nextCallback;callbacks.set(id,callback);return id;},
      unregisterCallback: (id:number) => callbacks.delete(id),
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === 'get_snapshot') return state;
        if (command === 'get_notification_target') return target;
        if (command === 'acknowledge_notification_target') {if(target?.requestId===args.requestId)target=null;return;}
        if (command === 'save_settings') {
          state = {...state, settings: args.settings as typeof state.settings};
          return state.settings;
        }
        if (command === 'get_recent_results') return {matches:state.matches.filter(m => m.status === 'fulltime'),updatedAt:state.updatedAt,error:null};
        if (command === 'get_match_details') {
          if(details==='error') throw new Error('Unavailable');
          if(details==='pending') return new Promise(()=>{});
          if(summary) return {...summary,matchId:args.id};
          const match = state.matches.find(m => m.id === args.id);
          const active = match && ['live','halftime','fulltime'].includes(match.status);
          return {matchId:args.id,updatedAt:new Date().toISOString(),stale:false,error:null,venue:match?.status==='scheduled'?'Test Stadium':null,
            events:active?[{id:'event-1',minute:"15'",period:1,seconds:900,kind:'goal',text:'A goal is scored.',teamId:match.home.id}]:[],
            statistics:active?[{teamId:match.home.id,name:'totalShots',label:'Shots',value:'3'},{teamId:match.away.id,name:'totalShots',label:'Shots',value:'2'}]:[],
            players:active?[{teamId:match.home.id,name:'Test Keeper',position:'GK',starter:true},
              ...Array.from({length:10},(_,i)=>({teamId:match.home.id,name:i===9?'Jordan Alexander West-Northumberland':`Test Player ${i+1}`,position:'FW',starter:true})),
              {teamId:match.away.id,name:'Away Keeper',position:'GK',starter:true}]:[]};
        }
        if (command === 'plugin:event|listen') {const id=++nextListener;listeners.set(id,{event:String(args.event),handler:Number(args.handler)});return id;}
        if (command === 'plugin:event|unlisten') {listeners.delete(Number(args.eventId));return;}
        if (command === 'plugin:autostart|is_enabled') return false;
        return null;
      }
    };
    Object.assign(window, {isTauri:true,__TAURI_INTERNALS__:internals});
  }, {snapshot:structuredClone(options.snapshot??mockSnapshot),details:options.details,summary:options.summary,notificationTarget:options.notificationTarget});
}

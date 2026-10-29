import type { Page } from '@playwright/test';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

// Test-only desktop bridge. It is injected by Playwright and is never bundled.
export async function installBridge(page: Page) {
  await page.addInitScript((snapshot) => {
    let state = snapshot;
    const internals = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 1,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === 'get_snapshot') return state;
        if (command === 'save_settings') {
          state = {...state, settings: args.settings as typeof state.settings};
          return state.settings;
        }
        if (command === 'get_recent_results') return {matches:state.matches.filter(m => m.status === 'fulltime'),updatedAt:state.updatedAt,error:null};
        if (command === 'get_match_details') {
          const match = state.matches.find(m => m.id === args.id);
          const active = match && ['live','halftime','fulltime'].includes(match.status);
          return {matchId:args.id,updatedAt:new Date().toISOString(),stale:false,error:null,
            events:active?[{id:'event-1',minute:"15'",period:1,seconds:900,kind:'goal',text:'A goal is scored.',teamId:match.home.id}]:[],
            statistics:active?[{teamId:match.home.id,name:'totalShots',label:'Shots',value:'3'},{teamId:match.away.id,name:'totalShots',label:'Shots',value:'2'}]:[],
            players:active?[{teamId:match.home.id,name:'Test Keeper',position:'GK',starter:true},
              ...Array.from({length:10},(_,i)=>({teamId:match.home.id,name:i===9?'Jordan Alexander West-Northumberland':`Test Player ${i+1}`,position:'FW',starter:true})),
              {teamId:match.away.id,name:'Away Keeper',position:'GK',starter:true}]:[]};
        }
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:autostart|is_enabled') return false;
        return null;
      }
    };
    Object.assign(window, {isTauri:true,__TAURI_INTERNALS__:internals});
  }, structuredClone(mockSnapshot));
}

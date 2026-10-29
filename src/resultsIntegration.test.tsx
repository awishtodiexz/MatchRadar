// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import App from './App';import { useApp } from './store';import { mockSnapshot } from './demo/fixtures';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:bridge.invoke}));vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{})}));
afterEach(cleanup);
it('shows a result outside yesterday/today and fetches its summary only when opened',async()=>{
 const completed={...mockSnapshot.matches[4],id:'401879268',kickoff:'2026-10-20T12:00:00Z'};const snapshot={...structuredClone(mockSnapshot),matches:[],settings:{...mockSnapshot.settings,mock:false}};
 bridge.invoke.mockImplementation(async(cmd:string,args?:{id:string})=>{if(cmd==='get_snapshot')return snapshot;if(cmd==='get_recent_results')return {matches:[completed],updatedAt:'2026-10-29T12:00:00Z',error:null};if(cmd==='get_match_details')return {matchId:args?.id,updatedAt:'2026-10-29T12:00:00Z',stale:false,error:null,events:[],statistics:[],players:[]};throw Error('Unexpected command '+cmd);});
 useApp.setState({snapshot:null,loading:true,error:null});render(<App/>);await waitFor(()=>expect(screen.getByText('No fixtures in this window')).toBeTruthy());
 expect(bridge.invoke.mock.calls.some(c=>c[0]==='get_recent_results')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Results'}));
 const card=await screen.findByRole('button',{name:'Match details: Brighton & Hove Albion versus Everton'});expect(bridge.invoke.mock.calls.some(c=>c[0]==='get_match_details')).toBe(false);
 fireEvent.click(card);await waitFor(()=>expect(bridge.invoke).toHaveBeenCalledWith('get_match_details',{id:'401879268'}));expect(screen.getByRole('heading',{name:'Match details'})).toBeTruthy();
});

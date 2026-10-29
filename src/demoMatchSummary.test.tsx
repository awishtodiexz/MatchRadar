// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import App from './App';
import { useApp } from './store';
import { mockSnapshot } from './mock';
import { demoMatchSummary } from './demoMatchSummary';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke,isTauri:()=>false}));
afterEach(cleanup);
it('opens a complete fictional centre from the normal completed demo card without IPC',async()=>{
 useApp.setState({snapshot:structuredClone(mockSnapshot),loading:false,error:null});await useApp.getState().load();render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Results'}));
 fireEvent.click(screen.getByRole('button',{name:'Match details: Brighton & Hove Albion versus Everton'}));
 expect(screen.getByText(/fictional match, players and events/)).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Timeline'}));expect(screen.getByText(/Alex Hart scores/)).toBeTruthy();expect(screen.getByText(/receives a red card/)).toBeTruthy();expect(screen.getByText(/Jamie Reed replaces/)).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Stats'}));expect(screen.getAllByText('Possession')).toHaveLength(2);
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));expect(screen.getByText('Casey Brook')).toBeTruthy();expect(screen.getAllByText('Starting XI')).toHaveLength(2);
 expect(bridge.invoke).not.toHaveBeenCalled();
});
it('supports native demo IDs and deterministic optional event fields',()=>{const m=mockSnapshot.matches.find(m=>m.status==='fulltime')!;const a=demoMatchSummary(m)!;const b=demoMatchSummary({...m,id:'demo-4'})!;expect(b.events).toEqual(a.events);expect(a.events.some(e=>e.teamId===null)).toBe(true);expect(a.events.map(e=>e.seconds)).toEqual(a.events.map(e=>e.seconds).sort((a,b)=>a-b));expect(a.players.filter(p=>p.starter)).toHaveLength(22);expect(a.players.filter(p=>!p.starter).length).toBeGreaterThan(0);expect(demoMatchSummary(mockSnapshot.matches[0])).toBeNull();});

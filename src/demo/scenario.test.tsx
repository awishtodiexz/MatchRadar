// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import App from '../App';import { useApp } from '../store';import { mockSnapshot } from './fixtures';
import { demoClock,progressDemo } from './scenario';import { demoMatchSummary } from './summary';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke,isTauri:()=>false}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('generates deterministic ordered progression with consistent goals and stable IDs',()=>{
 const base=structuredClone(mockSnapshot.matches);const city=base.find(m=>m.home.id==='382'&&m.away.id==='360')!;
 for(const [step,status,home,away] of [[0,'scheduled',null,null],[1,'live',0,0],[2,'halftime',1,0],[3,'live',1,1],[4,'fulltime',2,1]] as const){
  const m=progressDemo(base,step).find(m=>m.id===city.id)!;expect(m.status).toBe(status);expect(m.homeScore??null).toBe(home);expect(m.awayScore??null).toBe(away);expect(m.kickoff).toBe(city.kickoff);expect(demoClock(city,step)).toBe(demoClock(city,step));
  expect(progressDemo(base,step)).toEqual(progressDemo(base,step));
  if(step){const d=demoMatchSummary(m)!;expect(d.events.filter(e=>e.kind.includes('goal'))).toHaveLength((home??0)+(away??0));expect(d.events.map(e=>e.seconds)).toEqual(d.events.map(e=>e.seconds).sort((a,b)=>a-b));expect(new Set(d.events.map(e=>e.id)).size).toBe(d.events.length);}
 }
 expect(base.find(m=>m.id===city.id)?.status).toBe('scheduled');
});
it('offers manual controls only in demo and updates an open details view without IPC',async()=>{
 useApp.setState({snapshot:structuredClone(mockSnapshot),loading:false,error:null});await useApp.getState().load();render(<App/>);
 fireEvent.click(screen.getByRole('button',{name:'Settings'}));fireEvent.click(screen.getByRole('tab',{name:'App'}));
 expect(screen.getByRole('region',{name:'Demo controls'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Advance match'}));fireEvent.click(screen.getByRole('button',{name:'Back to matches'}));
 fireEvent.click(screen.getByRole('button',{name:'Match details: Manchester City versus Manchester United'}));expect(screen.getByText("20'")).toBeTruthy();
 act(()=>useApp.getState().demoControl('advance'));expect(screen.getByText('Half-time')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Timeline'}));expect(screen.getByText(/Alex Hart scores/)).toBeTruthy();
 act(()=>useApp.getState().demoControl('advance'));expect(screen.getByText('Robin Ash scores an own goal for the away side.')).toBeTruthy();
 act(()=>{useApp.getState().demoControl('advance');useApp.getState().demoControl('advance');});expect(useApp.getState().demoStep).toBe(4);expect(screen.getByText(/a penalty/)).toBeTruthy();
 act(()=>useApp.getState().demoControl('reset'));expect(useApp.getState().demoStep).toBe(0);expect(bridge.invoke).not.toHaveBeenCalled();
});
it('covers fixture statuses and meaningful filters without real match IDs',()=>{
 const m=mockSnapshot.matches;expect(new Set(m.map(x=>x.id)).size).toBe(m.length);expect(m.every(x=>x.id.startsWith('demo-')&&!Number.isNaN(Date.parse(x.kickoff)))).toBe(true);
 for(const status of ['scheduled','live','halftime','fulltime','postponed','cancelled','suspended','unknown'])expect(m.some(x=>x.status===status)).toBe(true);
 expect(m.some(x=>x.status==='fulltime'&&x.homeScore===4&&x.awayScore===3)).toBe(true);expect(m.some(x=>x.status==='fulltime'&&x.homeScore===0&&x.awayScore===0)).toBe(true);
});

it('keeps rich sample scores, events and lineups consistent',()=>{
 for(const match of mockSnapshot.matches.filter(m=>['live','halftime','fulltime'].includes(m.status))){
  const details=demoMatchSummary(match)!;
  expect(details.events.filter(event=>event.kind.includes('goal'))).toHaveLength((match.homeScore??0)+(match.awayScore??0));
  for(const team of [match.home,match.away])expect(details.players.filter(player=>player.teamId===team.id&&player.starter)).toHaveLength(11);
  expect(details.statistics.length).toBeGreaterThan(0);
  const sub=details.events.find(event=>event.kind==='substitution');
  if(sub){expect(details.players.some(player=>!player.starter&&sub.text.includes(player.name))).toBe(true);expect(details.players.some(player=>player.starter&&sub.text.includes(player.name))).toBe(true);}
 }
 const upcoming=mockSnapshot.matches.find(m=>m.status==='scheduled')!;expect(demoMatchSummary(upcoming)).toBeNull();
});

it('leaving demo clears simulation without sending synthetic data or losing settings',async()=>{
 useApp.setState({snapshot:structuredClone(mockSnapshot),loading:false,error:null});await useApp.getState().load();const favorites=useApp.getState().snapshot!.settings.favorites;
 act(()=>useApp.getState().demoControl('advance'));expect(useApp.getState().demoStep).toBe(1);
 await act(async()=>useApp.getState().save({mock:false}));expect(useApp.getState().demoStep).toBe(0);expect(useApp.getState().snapshot?.matches).toEqual([]);expect(useApp.getState().snapshot?.settings.favorites).toEqual(favorites);act(()=>useApp.getState().demoControl('advance'));expect(useApp.getState().demoStep).toBe(0);expect(bridge.invoke).not.toHaveBeenCalled();
});

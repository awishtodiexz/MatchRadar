// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { positionGroup } from './MatchLineups';
import { formatStatisticValue } from './MatchStats';
import { mockSnapshot } from '../test-fixtures/fixtures';
import type { MatchSummary } from '../useMatchSummary';
const state=vi.hoisted(()=>({data:{matchId:'1',updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false,venue:null as string|null,events:[{id:'e',minute:"45+2'",period:1,seconds:2820,kind:'goal',text:'Verified provider goal',teamId:'359'}],statistics:[{teamId:'359',name:'redCards',label:'Red cards',value:'0'}],players:[{teamId:'359',name:'A long player name',position:'G',starter:true}]} as MatchSummary,loading:false,error:null,retry:vi.fn(),refresh:vi.fn(),refreshing:false,real:false}));
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>state.real,invoke:bridge.invoke}));
// Most tests use the fixed state above; only the refresh test runs the real hook over the mocked invoke.
vi.mock('../useMatchSummary',async(importOriginal)=>{const actual=await importOriginal<typeof import('../useMatchSummary')>();return {useMatchSummary:(...args:Parameters<typeof actual.useMatchSummary>)=>state.real?actual.useMatchSummary(...args):state};});
const initial=structuredClone(state.data);
afterEach(()=>{cleanup();state.data=structuredClone(initial);state.loading=false;state.error=null;state.real=false;bridge.invoke.mockReset();});
it('offers available sections and displays explicit zero stats and player names',()=>{render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));expect(screen.getByText("45+2'")).toBeTruthy();expect(screen.getByText('Verified provider goal')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Stats'}));expect(screen.getByText('0')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));expect(screen.getByText('A long player name')).toBeTruthy();});
it('offers one details freshness line and refresh action in every section',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 for(const name of ['Overview','Stats','Lineups','Commentary']) {
  fireEvent.click(screen.getByRole('tab',{name}));
  expect(screen.getAllByText(/Match details updated/)).toHaveLength(1);
  const refresh=screen.getByRole('button',{name:'Refresh match details'});
  fireEvent.click(refresh);
  expect(state.refresh).toHaveBeenCalled();
 }
});
it('uses the existing tabs to access Stats and Commentary without repeated Overview links',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.queryByRole('button',{name:/Match commentary|Full statistics/})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Stats'}));expect(screen.getByRole('table',{name:'Team statistics'})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));expect(screen.getByText('Verified provider goal')).toBeTruthy();
});
it('keeps sections available when their data is empty',()=>{const old=state.data;state.data={...old,events:[],statistics:[],players:[]};render(<MatchCentre match={mockSnapshot.matches[0]}/>);expect(screen.getByRole('tab',{name:'Commentary'})).toBeTruthy();expect(screen.getByRole('region',{name:'Match information'})).toBeTruthy();state.data=old;});
it('retains visible detail content without inserting a skeleton during a refresh',()=>{
 state.loading=true;render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.queryByLabelText('Loading match details')).toBeNull();
 expect(screen.getByRole('tab',{name:'Commentary'})).toBeTruthy();
 expect(screen.getByRole('region',{name:'Match centre'}).getAttribute('aria-busy')).toBe('true');state.loading=false;
});
it('shows a supplied venue and clear pre-match copy without empty tabs',()=>{
 const old=state.data;state.data={...old,venue:'Villa Park',events:[],statistics:[],players:[]};
 render(<MatchCentre match={{...mockSnapshot.matches[0],status:'scheduled'}}/>);
 expect(screen.getByText('Villa Park')).toBeTruthy();expect(screen.getByText('Lineups and live coverage appear closer to kick-off.')).toBeTruthy();
 expect(screen.getByRole('tab',{name:'Commentary'})).toBeTruthy();state.data=old;
});

it('compares each statistic once and distinguishes a missing value from zero',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 const row=screen.getByRole('row',{name:/Red cards/});expect(row.textContent).toBe('0Red cards—');
});
it('highlights comparable ESPN statistics while keeping disciplinary counts neutral',()=>{
 const old=state.data;
 state.data={...old,statistics:[
  {teamId:'359',name:'possessionPct',label:'Possession',value:'58.2'},
  {teamId:'363',name:'possessionPct',label:'Possession',value:'41.8'},
  {teamId:'359',name:'totalShots',label:'Shots',value:'13'},
  {teamId:'363',name:'totalShots',label:'Shots',value:'11'},
  {teamId:'359',name:'foulsCommitted',label:'Fouls',value:'12'},
  {teamId:'363',name:'foulsCommitted',label:'Fouls',value:'20'},
  {teamId:'359',name:'passPct',label:'Pass Completion %',value:'0.8'},
  {teamId:'363',name:'passPct',label:'Pass Completion %',value:'0.7'}
 ]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 expect(screen.getByRole('columnheader',{name:'Passing'})).toBeTruthy();
 expect(screen.getByRole('row',{name:/Possession/}).querySelector('.stat-leading')?.textContent).toBe('58.2%');
 expect(screen.getByRole('row',{name:/Shots/}).querySelector('.stat-leading')?.textContent).toBe('13');
 expect(screen.getByRole('row',{name:/Fouls/}).querySelector('.stat-leading')).toBeNull();
 expect(screen.getByRole('row',{name:/Pass completion/}).textContent).toBe('80%Pass completion70%');state.data=old;
});
it('groups known positions without inventing a position for unknown players',()=>{
 const old=state.data;state.data={...old,players:[...old.players,{teamId:'359',name:'Unknown Player',position:'',starter:true}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('Goalkeepers')).toBeTruthy();expect(screen.getByText('Other positions')).toBeTruthy();expect(screen.getByText('Unknown Player')).toBeTruthy();state.data=old;
});

it('explains when one team has no lineup rather than showing an empty starting XI',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('Starting XI')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:/Chelsea/}));
 expect(screen.getByText('Lineup unavailable')).toBeTruthy();
});

it('shows scorers, formation, jersey numbers and substitutes without inventing data',()=>{
 const old=state.data;
 state.data={...old,
  events:[],
  scorers:[{teamId:'359',teamName:'Arsenal',name:'Bukayo Saka',minute:"23'",ownGoal:false,penalty:false}],
  substitutions:[{teamId:'359',playerIn:'Leandro Trossard',playerOut:'Bukayo Saka',minute:"60'"}],
  formations:{'359':'4-3-3'},
  players:[{teamId:'359',name:'David Raya',position:'G',starter:true,jersey:'22',formationPlace:1},
   {teamId:'359',name:'Bukayo Saka',position:'RW',starter:true,jersey:'7',formationPlace:5},
   {teamId:'359',name:'Leandro Trossard',position:'SUB',starter:false,jersey:'19',subbedIn:true}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.getByLabelText('Goalscorers')).toBeTruthy();
 expect(screen.getByText('Bukayo Saka')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('4-3-3')).toBeTruthy();
 expect(screen.getByText('#22')).toBeTruthy();
 expect(screen.getByText('Substitutes')).toBeTruthy();
 expect(screen.getByText('#19')).toBeTruthy();
 expect(screen.getAllByText(/Trossard/).length).toBeGreaterThan(0);
 expect(screen.getByText(/↓ 60'/)).toBeTruthy();
 expect(screen.getByText(/↑ 60'/)).toBeTruthy();
 expect(screen.queryByText('Substitutions')).toBeNull();
 expect(screen.getByText(/for Bukayo Saka/)).toBeTruthy();
 state.data=old;
});

it('shows real venue, attendance, form and team leaders on Overview',()=>{
 const old=state.data;
 state.data={...old,venue:'Elland Road',attendance:36924,
  form:{'359':[{opponent:'Chelsea',opponentId:'363',result:'W',score:'2-1',atHome:true}],
   '363':[{opponent:'Leeds United',opponentId:'357',result:'L',score:'1-2',atHome:false}]},
  leaders:[{teamId:'359',category:'Shots',name:'Bukayo Saka',jersey:'7',position:'RW',value:'3'}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.getByText('Elland Road')).toBeTruthy();
 expect(screen.getByText('36,924')).toBeTruthy();
 expect(screen.getByRole('heading',{name:/Form/})).toBeTruthy();
 expect(screen.getByLabelText(/Win against Chelsea/)).toBeTruthy();
 expect(screen.getByText('Team leaders')).toBeTruthy();
 expect(screen.getByText(/Bukayo Saka/)).toBeTruthy();
 state.data=old;
});

it('filters the timeline to key events without losing the full list',()=>{
 const old=state.data;
 state.data={...old,events:[...old.events,{id:'foul-1',minute:"15'",period:1,seconds:900,kind:'foul',text:'Foul by a defender.',teamId:'359'}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));
 expect(screen.getByText('Foul by a defender.')).toBeTruthy();
 const type=screen.getByRole('combobox',{name:'Commentary event type'}) as HTMLSelectElement;
 expect(screen.queryByRole('button',{name:'Key events'})).toBeNull();expect(type.value).toBe('all');
 fireEvent.change(type,{target:{value:'key'}});
 expect(screen.queryByText('Foul by a defender.')).toBeNull();
 expect(screen.getByText('Verified provider goal')).toBeTruthy();
 fireEvent.change(type,{target:{value:'all'}});
 expect(screen.getByText('Foul by a defender.')).toBeTruthy();
 state.data=old;
});

it('draws the selected team formation and changes the pitch with its tab',()=>{
 const old=state.data;
 const squad=(teamId:string)=>Array.from({length:11},(_,i)=>({
  teamId,name:`${teamId} Player ${i+1}`,position:i===0?'G':i<5?'CD':i<8?'CM':'CF',starter:true,jersey:String(i+1),formationPlace:i+1
 }));
 state.data={...old,formations:{'359':'4-3-3','363':'4-3-3'},players:[...squad('359'),...squad('363')]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 const pitch=document.querySelector('.lineup-pitch');
 expect(pitch).toBeTruthy();
 expect(pitch?.getAttribute('aria-label')).toBe('Arsenal starting XI at kickoff');
 expect(pitch?.querySelectorAll('.pitch-shirt')).toHaveLength(11);
 expect(pitch?.textContent).toContain('1');
 fireEvent.click(screen.getByRole('tab',{name:/Chelsea/}));
 expect(document.querySelector('.pitch-player')?.getAttribute('title')).toContain('Chelsea');
 expect(document.querySelectorAll('.pitch-shirt')).toHaveLength(11);
 expect(screen.getAllByText('4-3-3').length).toBeGreaterThan(0);
 state.data=old;
});

it('labels timeline periods and event types',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));
 expect(screen.getByText('First half')).toBeTruthy();
 expect(screen.getByText('Goal',{selector:'.event-kind'})).toBeTruthy();
});

it('exposes selected panels and supports arrow, Home and End keyboard navigation',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 const overview=screen.getByRole('tab',{name:'Overview'});overview.focus();fireEvent.keyDown(overview,{key:'End'});
 const timeline=screen.getByRole('tab',{name:'Commentary'});expect(document.activeElement).toBe(timeline);expect(timeline.getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tabpanel',{name:'Commentary'})).toBeTruthy();
 fireEvent.keyDown(timeline,{key:'ArrowLeft'});expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Lineups'}));fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(overview);
});

it('includes all compact goals and substitutions in Overview but excludes routine goal kicks',()=>{
 const old=state.data;
 state.data={...old,statistics:[{teamId:'359',name:'totalShots',label:'Shots',value:'9'}],events:[
  {id:'goal-kick',minute:'75',period:2,seconds:4500,kind:'goal-kick',text:'Routine goal kick',teamId:'359'},
  ...Array.from({length:15},(_,i)=>({id:'sub-'+i,minute:'73',period:2,seconds:4380+i,kind:'substitution',text:'Routine substitution '+i,teamId:'359',participants:['Player on '+i,'Player off '+i]})),
  ...Array.from({length:7},(_,i)=>({id:'goal-'+i,minute:String(50+i),period:2,seconds:3000+i,kind:'goal',text:'Goal '+i,teamId:'359',participants:['Scorer '+i]}))
 ]};
 const {container}=render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(container.querySelectorAll('.match-events .event')).toHaveLength(22);
 expect(container.querySelectorAll('.overview-scorers li')).toHaveLength(0);
 expect(screen.getByText('Second half')).toBeTruthy();expect(screen.getByText('Player on 0')).toBeTruthy();
 expect(screen.getByRole('region',{name:'Match information'})).toBeTruthy();
 expect(screen.queryByText('Routine goal kick')).toBeNull();
 expect(screen.queryByText('Shots')).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));
 expect(screen.getByRole('tab',{name:'Commentary'}).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByText('Routine substitution 0')).toBeTruthy();state.data=old;
});

it('keeps low possession percentages as percentage points and scales ratio metrics',()=>{
 const stat=(name:string,value:string)=>({teamId:'359',name,label:name,value});
 for(const value of ['0','0.5','1','99']) expect(formatStatisticValue('possessionPct',stat('possessionPct',value))).toBe(value+'%');
 expect(formatStatisticValue('passPct',stat('passPct','0.8'))).toBe('80%');
 expect(formatStatisticValue('passPct',stat('passPct','0.5%'))).toBe('0.5%');
 state.data={...state.data,statistics:[stat('possessionPct','1'),{...stat('possessionPct','99'),teamId:'363'}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 const row=screen.getByRole('row',{name:/Possession/});
 expect(row.textContent).toBe('1%Possession99%');expect(row.querySelector('.stat-leading')?.textContent).toBe('99%');
});
it('groups defensive midfielders separately from central defenders',()=>{
 for(const code of ['DM','CDM','DM-L','CDM-R','CM-L']) expect(positionGroup(code)).toBe('Midfielders');
 for(const code of ['D','DF','CD','CD-L','CD-R','RB','LWB']) expect(positionGroup(code)).toBe('Defenders');
 expect(positionGroup('UNKNOWN')).toBe('Other positions');
});
it('shows both on and off times for a substitute who later leaves the pitch',()=>{
 state.data={...state.data,players:[
  {teamId:'359',name:'Starter',position:'CF',starter:true},
  {teamId:'359',name:'Bench Player',position:'DM',starter:false,subbedIn:true,subbedOut:true},
  {teamId:'359',name:'Replacement',position:'DM',starter:false,subbedIn:true}
 ],substitutions:[
  {teamId:'359',playerIn:'Bench Player',playerOut:'Starter',minute:"60'"},
  {teamId:'359',playerIn:'Replacement',playerOut:'Bench Player',minute:"80'"}
 ]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 const row=screen.getAllByText('Bench Player').find(node=>node.closest('.lineup-list'))?.closest('li');
 expect(row?.querySelector('.sub-marker.on')?.getAttribute('title')).toBe("Substituted on at 60'");
 expect(row?.querySelector('.sub-marker.off')?.getAttribute('title')).toBe("Substituted off at 80'");
});
it('labels both statistic columns with their teams and uses a singular metric count',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 expect(screen.getByText('All statistics · 1 metric')).toBeTruthy();
 expect(screen.getByRole('columnheader',{name:'Arsenal'})).toBeTruthy();
 expect(screen.getByRole('columnheader',{name:'Chelsea'})).toBeTruthy();
});
it('reports how many commentary events a filter hides and offers a clear reset',()=>{
 const old=state.data;
 state.data={...old,events:[...old.events,{id:'foul-1',minute:"15'",period:1,seconds:900,kind:'foul',text:'Foul by a defender.',teamId:'359'}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Commentary event type'}),{target:{value:'cards'}});
 expect(screen.getByText(/0 of 2 events/)).toBeTruthy();
 expect(screen.getByText(/No events match this filter/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
 expect(screen.getByText('Verified provider goal')).toBeTruthy();
 expect(screen.getByText('Foul by a defender.')).toBeTruthy();
 state.data=old;
});
it('keeps half-time, full-time and VAR reviews in the commentary key-event filter',()=>{
 const old=state.data;
 state.data={...old,events:[...old.events,
  {id:'ht',minute:"45'+2'",period:1,seconds:2820,kind:'halftime',text:'Half-time.',teamId:null},
  {id:'var',minute:"23'",period:1,seconds:1380,kind:'var---referee-decision-cancelled',text:'VAR review.',teamId:'363',participants:['Igor Thiago']},
  {id:'ft',minute:"90'+6'",period:2,seconds:5400,kind:'end-regular-time',text:'Second half ends.',teamId:null}
 ]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Commentary'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Commentary event type'}),{target:{value:'key'}});
 expect(screen.getByText('Half-time.')).toBeTruthy();
 expect(screen.getByText('VAR review.')).toBeTruthy();
 expect(screen.getByText('Second half ends.')).toBeTruthy();
 state.data=old;
});
it('supports Home and End on the lineup team tabs',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 const arsenal=screen.getByRole('tab',{name:/Arsenal/});const chelsea=screen.getByRole('tab',{name:/Chelsea/});
 arsenal.focus();fireEvent.keyDown(arsenal,{key:'End'});
 expect(document.activeElement).toBe(chelsea);expect(chelsea.getAttribute('aria-selected')).toBe('true');
 fireEvent.keyDown(chelsea,{key:'Home'});
 expect(document.activeElement).toBe(arsenal);expect(arsenal.getAttribute('aria-selected')).toBe('true');
});
it('explains why a complete starting XI has no formation pitch',()=>{
 const old=state.data;
 state.data={...old,formations:{},players:Array.from({length:11},(_,i)=>({teamId:'359',name:`Player ${i+1}`,position:i===0?'G':'CD',starter:true}))};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('Formation unavailable for this lineup.')).toBeTruthy();
 state.data=old;
});
it('shows available empty states before kick-off',()=>{
 const old=state.data;state.data={...old,events:[],statistics:[],players:[]};
 render(<MatchCentre match={{...mockSnapshot.matches[0],status:'scheduled'}}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 expect(screen.getByRole('tab',{name:'Stats'}).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByText('Statistics are not available for this match.')).toBeTruthy();
 expect(screen.queryByRole('table',{name:'Team statistics'})).toBeNull();state.data=old;
});
it('forces a cache-bypassing details refresh from the Overview freshness line',async()=>{
 const id=mockSnapshot.matches[0].id;state.real=true;
 bridge.invoke.mockResolvedValue({...structuredClone(initial),matchId:id,stale:false,error:null});
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 await screen.findByText(/Match details updated/);
 bridge.invoke.mockClear();
 const refresh=screen.getByRole('button',{name:'Refresh match details'});
 fireEvent.click(refresh);
 expect(bridge.invoke).toHaveBeenCalledWith('get_match_details',{id,force:true});
 expect(refresh.hasAttribute('disabled')).toBe(true);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh match details'}).hasAttribute('disabled')).toBe(false),{timeout:2000});
});

const stat=(teamId:string,name:string,value:string)=>({teamId,name,label:name,value});
const pair=(name:string,home:string,away:string)=>[stat('359',name,home),stat('363',name,away)];
const openTab=(name:string)=>fireEvent.click(screen.getByRole('tab',{name}));
it('splits each comparison bar at the true home/away ratio and only colours the leading side',()=>{
 state.data={...state.data,statistics:[...pair('possessionPct','58.7','41.3'),...pair('totalShots','0','0'),...pair('foulsCommitted','12','20'),...pair('wonCorners','0','4')]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Stats');
 const bar=(label:RegExp)=>screen.getByRole('row',{name:label}).querySelector('.stat-bar') as HTMLElement;
 const possession=bar(/Possession/);
 expect(possession.querySelectorAll('i')).toHaveLength(2);
 expect(possession.dataset.homeShare).toBe('0.587');
 expect((possession.querySelector('.bar-home') as HTMLElement).style.flexGrow).toBe('0.587');
 expect((possession.querySelector('.bar-away') as HTMLElement).style.flexGrow).toBe('0.413');
 expect(possession.querySelector('.bar-home')?.classList.contains('winning')).toBe(true);
 expect(possession.querySelector('.bar-away')?.classList.contains('winning')).toBe(false);
 const empty=bar(/Shots/);expect(empty.dataset.homeShare).toBe('0.500');expect(empty.querySelector('.winning')).toBeNull();
 expect(bar(/Fouls/).querySelector('.winning')).toBeNull();
 const shutout=bar(/Corners/);expect(shutout.querySelectorAll('i')).toHaveLength(1);expect(shutout.querySelector('.bar-away.winning')).toBeTruthy();
});
it('opens on the key statistics, with a toggle for every metric and a category filter that shows the whole category',()=>{
 const extra=['expectedGoalsNonPenalty','shotsOffTarget','blockedShots','touches','shotAssists','totalCrosses','duels','interceptions'];
 state.data={...state.data,statistics:[...pair('possessionPct','60','40'),...pair('totalShots','10','5'),...pair('passPct','0.8','0.7'),...extra.flatMap(name=>pair(name,'3','4'))]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Stats');
 expect(screen.getByText('Key statistics · 3 of 11')).toBeTruthy();
 expect(screen.getAllByRole('row').filter(row=>row.classList.contains('stat-row'))).toHaveLength(3);
 expect(screen.queryByRole('row',{name:/Interceptions/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show all 11 statistics'}));
 expect(screen.getByText('All statistics · 11 metrics')).toBeTruthy();
 expect(screen.getByRole('row',{name:/Interceptions/})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Show key statistics'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Statistic group'}),{target:{value:'Passing'}});
 expect(screen.getByText('Passing · 4 metrics')).toBeTruthy();
 expect(screen.getByRole('row',{name:/Crosses/})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Show all/})).toBeNull();
});
it('hides the Coach row when no coach is supplied and shows it when there is one',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Lineups');
 expect(screen.queryByText('Coach')).toBeNull();expect(screen.queryByText(/Not provided by ESPN/)).toBeNull();
 cleanup();
 state.data={...state.data,coaches:[{teamId:'359',name:'Mikel Arteta'}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Lineups');
 expect(screen.getByText('Coach').closest('.coach-row')?.textContent).toContain('Mikel Arteta');
});
it('merges substitutions into the bench: used subs first by minute with who they replaced, unused dimmed by number, no SUB label',()=>{
 const sub=(name:string,jersey:string,extra={})=>({teamId:'359',name,position:'SUB',starter:false,jersey,...extra});
 state.data={...state.data,players:[
  {teamId:'359',name:'Starter One',position:'CF',starter:true,jersey:'9'},{teamId:'359',name:'Starter Two',position:'CM',starter:true,jersey:'8'},
  sub('Unused Twenty','20'),sub('Late Sub','14',{subbedIn:true}),sub('Unused Three','3'),sub('Early Sub','11',{subbedIn:true})],
  substitutions:[{teamId:'359',playerIn:'Late Sub',playerOut:'Starter Two',minute:"90'+2'"},{teamId:'359',playerIn:'Early Sub',playerOut:'Starter One',minute:"58'"}]};
 const {container}=render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Lineups');
 const rows=[...container.querySelectorAll('.bench-list li')];
 expect(rows.map(row=>row.querySelector('.bench-name')?.firstChild?.textContent)).toEqual(['Early Sub','Late Sub','Unused Three','Unused Twenty']);
 expect(rows.map(row=>row.classList.contains('is-unused'))).toEqual([false,false,true,true]);
 expect(rows[0].querySelector('.sub-for')?.textContent).toBe('for Starter One');
 expect(rows[1].querySelector('.sub-marker.on')?.textContent).toBe("↑ 90+2'");
 expect(rows[0].querySelector('.sub-marker.on')?.textContent).toBe("↑ 58'");
 expect(rows[2].querySelector('.sub-for')).toBeNull();
 expect(screen.queryByText('SUB')).toBeNull();expect(screen.queryByRole('heading',{name:'Substitutions'})).toBeNull();
});
it('badges pitch players with goals, cards and the minute they were subbed off',()=>{
 const squad=Array.from({length:11},(_,i)=>({teamId:'359',name:`Player ${i+1}`,position:i===0?'G':i<5?'CD':i<8?'CM':'CF',starter:true,jersey:String(i+1),formationPlace:i+1}));
 const ev=(id:string,kind:string,name:string,minute:string)=>({id,minute,period:2,seconds:3000,kind,text:kind,teamId:'359',participants:[name]});
 state.data={...state.data,formations:{'359':'4-3-3'},players:squad,
  events:[ev('g1','goal','Player 11',"23'"),ev('g2','goal','Player 11',"70'"),ev('y','yellow-card','Player 3',"30'"),ev('r','red-card','Player 4',"88'"),{...ev('og','own-goal','Player 5',"10'"),teamId:'363'}],
  substitutions:[{teamId:'359',playerIn:'Bench',playerOut:'Player 9',minute:"74'"}]};
 const {container}=render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Lineups');
 const player=(n:number)=>[...container.querySelectorAll('.pitch-player')].find(el=>el.querySelector('.pitch-shirt')?.textContent===String(n))!;
 expect(player(11).querySelector('.badge-goal')?.textContent).toBe('2');
 expect(player(11).getAttribute('title')).toContain("Goal 23'");
 expect(player(3).querySelector('.card-yellow')).toBeTruthy();expect(player(3).querySelector('.card-red')).toBeNull();
 expect(player(4).querySelector('.card-red')).toBeTruthy();
  expect(player(9).querySelector('.badge-off')?.textContent).toBe("74'");
  expect(player(9).getAttribute('aria-label')).toContain("Subbed off 74'");
 expect(player(5).querySelector('.pitch-badge')).toBeNull();
 expect(player(1).querySelector('.pitch-badge')).toBeNull();
});
it('offers Key events as an event-type option instead of a separate All/Key toggle',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Commentary');
 expect(screen.queryByRole('group',{name:'Commentary filter'})).toBeNull();
 const type=screen.getByRole('combobox',{name:'Commentary event type'}) as HTMLSelectElement;
 expect([...type.options].map(option=>option.textContent)).toEqual(['All event types','Key events','Goals','Cards','Substitutions','Shots & chances','VAR & stoppages']);
 expect(type.value).toBe('all');
 expect(screen.getByRole('combobox',{name:'Commentary order'})).toBeTruthy();
});
it("writes added time as 90+11' in commentary and gives every event its team crest",()=>{
 state.data={...state.data,events:[
  {id:'late',minute:"90'+11'",period:2,seconds:6000,kind:'corner',text:'Corner, Arsenal.',teamId:'359'},
  {id:'ok',minute:"34'",period:1,seconds:2040,kind:'foul',text:'Foul by Trevoh Chalobah (Chelsea).',teamId:'363'}]};
 const {container}=render(<MatchCentre match={mockSnapshot.matches[0]}/>);openTab('Commentary');
 expect(screen.getByText("90+11'")).toBeTruthy();expect(screen.queryByText("90'+11'")).toBeNull();
 expect(container.querySelectorAll('.event-team[role="img"]')).toHaveLength(2);
 expect(screen.getByRole('img',{name:'Arsenal'})).toBeTruthy();expect(screen.getByRole('img',{name:'Chelsea'})).toBeTruthy();
 expect(container.querySelectorAll('.event-team')[0].textContent).toBe('ARS');expect(container.querySelectorAll('.event-team')[1].textContent).toBe('CHE');
});
it('words the Overview freshness line relatively with the absolute time as a tooltip',()=>{
 const now=new Date(Date.now()-9*60*1000).toISOString();
 state.data={...state.data,updatedAt:now};
 const {unmount}=render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 const line=screen.getByText('Match details updated 9m ago');
 expect(line.getAttribute('title')).toBeTruthy();expect(line.getAttribute('title')).not.toMatch(/9m ago/);unmount();
 state.data={...state.data,stale:true};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.getByText('Saved details · updated 9m ago')).toBeTruthy();
});

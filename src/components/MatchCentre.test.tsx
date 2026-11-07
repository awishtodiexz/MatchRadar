// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { mockSnapshot } from '../test-fixtures/fixtures';
import type { MatchSummary } from '../useMatchSummary';
const state=vi.hoisted(()=>({data:{matchId:'1',updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false,venue:null as string|null,events:[{id:'e',minute:"45+2'",period:1,seconds:2820,kind:'goal',text:'Verified provider goal',teamId:'359'}],statistics:[{teamId:'359',name:'redCards',label:'Red cards',value:'0'}],players:[{teamId:'359',name:'A long player name',position:'G',starter:true}]} as MatchSummary,loading:false,error:null,retry:vi.fn()}));
vi.mock('../useMatchSummary',()=>({useMatchSummary:()=>state}));
afterEach(cleanup);
it('offers available sections and displays explicit zero stats and player names',()=>{render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Timeline'}));expect(screen.getByText("45+2'")).toBeTruthy();expect(screen.getByText('Verified provider goal')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Stats'}));expect(screen.getByText('0')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));expect(screen.getByText('A long player name')).toBeTruthy();});
it('uses a singular event count when there is one event',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.getByText('1 event available in Timeline.')).toBeTruthy();
});
it('omits unavailable sections rather than displaying empty tabs',()=>{const old=state.data;state.data={...old,events:[],statistics:[],players:[]};render(<MatchCentre match={mockSnapshot.matches[0]}/>);expect(screen.queryByRole('tab',{name:'Timeline'})).toBeNull();expect(screen.getByText('No event timeline is available for this match.')).toBeTruthy();state.data=old;});
it('retains visible detail content without inserting a skeleton during a refresh',()=>{
 state.loading=true;render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.queryByLabelText('Loading match details')).toBeNull();
 expect(screen.getByRole('tab',{name:'Timeline'})).toBeTruthy();
 expect(screen.getByRole('region',{name:'Match centre'}).getAttribute('aria-busy')).toBe('true');state.loading=false;
});
it('shows a supplied venue and clear pre-match copy without empty tabs',()=>{
 const old=state.data;state.data={...old,venue:'Villa Park',events:[],statistics:[],players:[]};
 render(<MatchCentre match={{...mockSnapshot.matches[0],status:'scheduled'}}/>);
 expect(screen.getByText('Villa Park')).toBeTruthy();expect(screen.getByText('Match information will appear when available.')).toBeTruthy();
 expect(screen.queryByRole('tab',{name:'Timeline'})).toBeNull();state.data=old;
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
 expect(screen.getByText('Passing')).toBeTruthy();
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
  scorers:[{teamId:'359',teamName:'Arsenal',name:'Bukayo Saka',minute:"23'",ownGoal:false,penalty:false}],
  substitutions:[{teamId:'359',playerIn:'Leandro Trossard',playerOut:'Bukayo Saka',minute:"60'"}],
  formations:{'359':'4-3-3'},
  players:[{teamId:'359',name:'David Raya',position:'G',starter:true,jersey:'22',formationPlace:1},
   {teamId:'359',name:'Bukayo Saka',position:'RW',starter:true,jersey:'7',formationPlace:5},
   {teamId:'359',name:'Leandro Trossard',position:'SUB',starter:false,jersey:'19',subbedIn:true}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 expect(screen.getByText('Goals')).toBeTruthy();
 expect(screen.getByText('Bukayo Saka')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('4-3-3')).toBeTruthy();
 expect(screen.getByText('#22')).toBeTruthy();
 expect(screen.getByText('Substitutes')).toBeTruthy();
 expect(screen.getByText('#19')).toBeTruthy();
 expect(screen.getAllByText(/Trossard/).length).toBeGreaterThan(0);
 expect(screen.getByText(/↓ 60'/)).toBeTruthy();
 expect(screen.getByText(/↑ 60'/)).toBeTruthy();
 expect(screen.getByText('Substitutions')).toBeTruthy();
 expect(screen.getByText(/for Bukayo Saka/)).toBeTruthy();
 state.data=old;
});

it('draws both formations when all twenty-two starter places are known',()=>{
 const old=state.data;
 const squad=(teamId:string)=>Array.from({length:11},(_,i)=>({
  teamId,name:`${teamId} Player ${i+1}`,position:i===0?'G':i<5?'CD':i<8?'CM':'CF',starter:true,jersey:String(i+1),formationPlace:i+1
 }));
 state.data={...old,formations:{'359':'4-3-3','363':'4-3-3'},players:[...squad('359'),...squad('363')]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 const pitch=document.querySelector('.lineup-pitch');
 expect(pitch).toBeTruthy();
 expect(pitch?.getAttribute('aria-hidden')).toBe('true');
 expect(pitch?.querySelectorAll('.pitch-shirt')).toHaveLength(22);
 expect(screen.getAllByText('4-3-3').length).toBeGreaterThan(0);
 state.data=old;
});

it('labels timeline periods and event types',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Timeline'}));
 expect(screen.getByText('First half')).toBeTruthy();
 expect(screen.getByText('GOAL')).toBeTruthy();
});

it('exposes selected panels and supports arrow, Home and End keyboard navigation',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 const overview=screen.getByRole('tab',{name:'Overview'});overview.focus();fireEvent.keyDown(overview,{key:'ArrowRight'});
 const timeline=screen.getByRole('tab',{name:'Timeline'});expect(document.activeElement).toBe(timeline);expect(timeline.getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tabpanel',{name:'Timeline'})).toBeTruthy();
 fireEvent.keyDown(timeline,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Lineups'}));fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(overview);
});

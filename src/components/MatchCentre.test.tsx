// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { mockSnapshot } from '../test-fixtures/fixtures';
const state=vi.hoisted(()=>({data:{matchId:'1',updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false,venue:null as string|null,events:[{id:'e',minute:"45+2'",kind:'goal',text:'Verified provider goal',teamId:'359'}],statistics:[{teamId:'359',name:'redCards',label:'Red cards',value:'0'}],players:[{teamId:'359',name:'A long player name',position:'G',starter:true}]},loading:false,error:null,retry:vi.fn()}));
vi.mock('../useMatchSummary',()=>({useMatchSummary:()=>state}));
afterEach(cleanup);
it('offers available sections and displays explicit zero stats and player names',()=>{render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Timeline'}));expect(screen.getByText("45+2'")).toBeTruthy();expect(screen.getByText('Verified provider goal')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Stats'}));expect(screen.getByText('0')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));expect(screen.getByText('A long player name')).toBeTruthy();});
it('omits unavailable sections rather than displaying empty tabs',()=>{const old=state.data;state.data={...old,events:[],statistics:[],players:[]};render(<MatchCentre match={mockSnapshot.matches[0]}/>);expect(screen.queryByRole('tab',{name:'Timeline'})).toBeNull();expect(screen.getByText('No event timeline is available for this match.')).toBeTruthy();state.data=old;});
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
  {teamId:'363',name:'foulsCommitted',label:'Fouls',value:'20'}
 ]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Stats'}));
 expect(screen.getByRole('row',{name:/Possession/}).querySelector('.stat-leading')?.textContent).toBe('58.2');
 expect(screen.getByRole('row',{name:/Shots/}).querySelector('.stat-leading')?.textContent).toBe('13');
 expect(screen.getByRole('row',{name:/Fouls/}).querySelector('.stat-leading')).toBeNull();state.data=old;
});
it('groups known positions without inventing a position for unknown players',()=>{
 const old=state.data;state.data={...old,players:[...old.players,{teamId:'359',name:'Unknown Player',position:'',starter:true}]};
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getByText('Goalkeepers')).toBeTruthy();expect(screen.getByText('Other positions')).toBeTruthy();expect(screen.getByText('Unknown Player')).toBeTruthy();state.data=old;
});

it('explains when one team has no lineup rather than showing an empty starting XI',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Lineups'}));
 expect(screen.getAllByText('Starting XI')).toHaveLength(1);
 expect(screen.getByText('Lineup unavailable')).toBeTruthy();
});

it('exposes selected panels and supports arrow, Home and End keyboard navigation',()=>{
 render(<MatchCentre match={mockSnapshot.matches[0]}/>);
 const overview=screen.getByRole('tab',{name:'Overview'});overview.focus();fireEvent.keyDown(overview,{key:'ArrowRight'});
 const timeline=screen.getByRole('tab',{name:'Timeline'});expect(document.activeElement).toBe(timeline);expect(timeline.getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('tabpanel',{name:'Timeline'})).toBeTruthy();
 fireEvent.keyDown(timeline,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('tab',{name:'Lineups'}));fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(overview);
});

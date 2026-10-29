// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MatchCentre } from './components/MatchCentre';
import { mockSnapshot } from './mock';
const state=vi.hoisted(()=>({data:{matchId:'1',updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false,events:[{id:'e',minute:"45+2'",kind:'goal',text:'Verified provider goal',teamId:'359'}],statistics:[{teamId:'359',name:'redCards',label:'Red cards',value:'0'}],players:[{teamId:'359',name:'A long player name',position:'G',starter:true}]},loading:false,error:null,retry:vi.fn()}));
vi.mock('./useMatchSummary',()=>({useMatchSummary:()=>state}));
afterEach(cleanup);
it('offers available sections and displays explicit zero stats and player names',()=>{render(<MatchCentre match={mockSnapshot.matches[0]} demo={false}/>);fireEvent.click(screen.getByRole('button',{name:'Timeline'}));expect(screen.getByText("45+2'")).toBeTruthy();expect(screen.getByText('Verified provider goal')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Stats'}));expect(screen.getByText('0')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Lineups'}));expect(screen.getByText('A long player name')).toBeTruthy();});
it('omits unavailable sections rather than displaying empty tabs',()=>{const old=state.data;state.data={...old,events:[],statistics:[],players:[]};render(<MatchCentre match={mockSnapshot.matches[0]} demo={false}/>);expect(screen.queryByRole('button',{name:'Timeline'})).toBeNull();expect(screen.getByText('No event timeline is available for this match.')).toBeTruthy();state.data=old;});

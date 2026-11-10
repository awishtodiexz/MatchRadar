// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { MatchDetails } from './MatchDetails';
import { defaults,mockMatches } from '../test-fixtures/fixtures';
import { timeLabel } from '../presentation';
vi.mock('../useMatchSummary',()=>({useMatchSummary:()=>({data:null,loading:false,error:null,retry:vi.fn()})}));
afterEach(cleanup);

it('shows kick-off time and an explicit note for a postponed match',()=>{
 const match=mockMatches[5];
 render(<MatchDetails match={match} settings={defaults} back={()=>{}}/>);
 expect(document.querySelector('.detail-score > span')?.textContent).toBe(timeLabel(match.kickoff));
 expect(screen.getByText('POSTPONED')).toBeTruthy();
 expect(screen.getByText('This match has been postponed.')).toBeTruthy();
 expect(screen.getByText('Match information')).toBeTruthy();
});

it('shows kick-off time and an explicit note for a cancelled match',()=>{
 const match=mockMatches[9];
 render(<MatchDetails match={match} settings={defaults} back={()=>{}}/>);
 expect(document.querySelector('.detail-score > span')?.textContent).toBe(timeLabel(match.kickoff));
 expect(screen.getByText('CANCELLED')).toBeTruthy();
 expect(screen.getByText('This match was cancelled.')).toBeTruthy();
});

it('keeps the score and scoreboard for a played match',()=>{
 const match=mockMatches[4];
 render(<MatchDetails match={match} settings={defaults} back={()=>{}}/>);
 expect(document.querySelector('.detail-score > span')?.textContent).toBe('1 – 1');
 expect(screen.getByText('FULL-TIME')).toBeTruthy();
});

it('shows knockout leg and aggregate context when the provider supplies it',()=>{
 const match={...mockMatches[4],leg:'2nd Leg',aggregate:'6-4'};
 render(<MatchDetails match={match} settings={defaults} back={()=>{}}/>);
 expect(screen.getByText(/2nd Leg · Aggregate 6-4/)).toBeTruthy();
});

it('omits knockout context for league matches',()=>{
 render(<MatchDetails match={mockMatches[4]} settings={defaults} back={()=>{}}/>);
 expect(screen.queryByText(/Aggregate/)).toBeNull();
});

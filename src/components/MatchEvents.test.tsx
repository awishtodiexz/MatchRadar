// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MatchEvents } from './MatchEvents';
import { mockMatches } from '../test-fixtures/fixtures';
import type { MatchSummary } from '../useMatchSummary';

afterEach(cleanup);
const match = mockMatches[0];
const events:MatchSummary['events'] = [
  {id:'late',minute:"60'",period:2,seconds:3600,kind:'substitution',text:'Away substitution',teamId:match.away.id},
  {id:'unknown',minute:"10'",period:1,seconds:600,kind:'kickoff',text:'Neutral event',teamId:null},
  {id:'early',minute:"20'",period:1,seconds:1200,kind:'goal',text:'Home goal',teamId:match.home.id},
];
it('keeps unknown-team events neutral and orders a side-aware summary chronologically',()=>{
  render(<MatchEvents match={match} events={events}/>);
  expect(screen.getAllByRole('listitem').map(row=>row.querySelector('.incident-player, p')?.textContent)).toEqual(['Kick-off','Home goal','Away substitution']);
  expect(screen.getByText('Kick-off').closest('li')?.classList.contains('neutral')).toBe(true);
  expect(screen.getByText('Home goal').closest('li')?.classList.contains('home')).toBe(true);
  expect(screen.getByText('Away substitution').closest('li')?.classList.contains('away')).toBe(true);
  expect(events[0].id).toBe('late');
});
it('shows verified running and period scores only when goal events reconcile with the scoreboard',()=>{
 const goal={...events[2],participants:['Scorer']};
 const {container,unmount}=render(<MatchEvents match={{...match,homeScore:1,awayScore:0}} events={[goal]}/>);
 expect(container.querySelector('.incident-score')?.textContent).toBe('1–0');
 expect(screen.getByLabelText('Period score').textContent).toBe('1–0');unmount();
 const incomplete=render(<MatchEvents match={{...match,homeScore:2,awayScore:0}} events={[goal]}/>);
 expect(incomplete.container.querySelector('.incident-score')).toBeNull();expect(screen.queryByLabelText('Period score')).toBeNull();
});
it('supports chronological commentary without shortening its provider description',()=>{
 const text='Full provider text. '.repeat(40);
 render(<MatchEvents match={match} events={[{...events[2],text},events[0]]} commentary newestFirst={false}/>);
 expect(screen.getAllByRole('listitem')[0].querySelector('p')?.textContent).toBe(text);
});
it('orders full commentary newest first across halves without dropping provider text',()=>{
  render(<MatchEvents match={match} events={events} commentary/>);
  expect(screen.getAllByRole('listitem').map(row=>row.querySelector('.incident-player, p')?.textContent)).toEqual(['Away substitution','Home goal','Neutral event']);
});
it('uses participant names in compact rows and does not color a scored penalty as a red card',()=>{
 const penalty={...events[2],kind:'penalty-scored',participants:['Enzo Le Fee'],text:'Goal! Sunderland 1, Chelsea 0. Enzo Le Fee converts the penalty.'};
 render(<MatchEvents match={match} events={[penalty]}/>);
 expect(screen.getByText('Enzo Le Fee')).toBeTruthy();
 expect(screen.queryByText(penalty.text)).toBeNull();
 expect(screen.getByRole('listitem').classList.contains('red')).toBe(false);
 expect(screen.getByRole('listitem').classList.contains('goal')).toBe(true);
});
it('makes card reasons and both substitution directions visible without commentary paragraphs',()=>{
 render(<MatchEvents match={match} events={[
  {...events[2],kind:'yellow-card',participants:['Booked player'],reason:'Bad foul'},
  {...events[0],participants:['Incoming player','Outgoing player'],reason:'Injury'},
 ]}/>);
 expect(screen.getByText('Yellow card · Bad foul')).toBeTruthy();
 expect(screen.getByText('On')).toBeTruthy();expect(screen.getByText('Off')).toBeTruthy();
 expect(screen.getByText('Incoming player')).toBeTruthy();expect(screen.getByText(/Outgoing player/)).toBeTruthy();
 expect(screen.getByText(/\(Injury\)/)).toBeTruthy();
});

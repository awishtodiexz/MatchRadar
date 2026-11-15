// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MatchEvents } from './MatchEvents';
import { mockMatches } from '../test-fixtures/fixtures';
import type { MatchSummary } from '../useMatchSummary';

afterEach(cleanup);
const match = mockMatches[0];
const events: MatchSummary['events'] = [
  {
    id: 'late',
    minute: "60'",
    period: 2,
    seconds: 3600,
    kind: 'substitution',
    text: 'Away substitution',
    teamId: match.away.id,
  },
  { id: 'unknown', minute: "10'", period: 1, seconds: 600, kind: 'kickoff', text: 'Neutral event', teamId: null },
  { id: 'early', minute: "20'", period: 1, seconds: 1200, kind: 'goal', text: 'Home goal', teamId: match.home.id },
];
it('keeps unknown-team events neutral and orders a side-aware summary chronologically', () => {
  render(<MatchEvents match={match} events={events} />);
  expect(screen.getAllByRole('listitem').map((row) => row.querySelector('.incident-player, p')?.textContent)).toEqual([
    'Kick-off',
    'Home goal',
    'Away substitution',
  ]);
  expect(screen.getByText('Kick-off').closest('li')?.classList.contains('neutral')).toBe(true);
  expect(screen.getByText('Home goal').closest('li')?.classList.contains('home')).toBe(true);
  expect(screen.getByText('Away substitution').closest('li')?.classList.contains('away')).toBe(true);
  expect(events[0].id).toBe('late');
});
it('shows verified running and period scores only when goal events reconcile with the scoreboard', () => {
  const goal = { ...events[2], participants: ['Scorer'] };
  const { container, unmount } = render(
    <MatchEvents match={{ ...match, homeScore: 1, awayScore: 0 }} events={[goal]} />,
  );
  expect(container.querySelector('.incident-score')?.textContent).toBe('1–0');
  expect(screen.getByLabelText('Period score').textContent).toBe('1–0');
  unmount();
  const incomplete = render(<MatchEvents match={{ ...match, homeScore: 2, awayScore: 0 }} events={[goal]} />);
  expect(incomplete.container.querySelector('.incident-score')).toBeNull();
  expect(screen.queryByLabelText('Period score')).toBeNull();
});
it('supports chronological commentary without shortening its provider description', () => {
  const text = 'Full provider text. '.repeat(40);
  render(<MatchEvents match={match} events={[{ ...events[2], text }, events[0]]} commentary newestFirst={false} />);
  expect(screen.getAllByRole('listitem')[0].querySelector('p')?.textContent).toBe(text);
});
it('orders full commentary newest first across halves without dropping provider text', () => {
  render(<MatchEvents match={match} events={events} commentary />);
  expect(screen.getAllByRole('listitem').map((row) => row.querySelector('.incident-player, p')?.textContent)).toEqual([
    'Away substitution',
    'Home goal',
    'Neutral event',
  ]);
});
it('uses participant names in compact rows and does not color a scored penalty as a red card', () => {
  const penalty = {
    ...events[2],
    kind: 'penalty-scored',
    participants: ['Enzo Le Fee'],
    text: 'Goal! Sunderland 1, Chelsea 0. Enzo Le Fee converts the penalty.',
  };
  render(<MatchEvents match={match} events={[penalty]} />);
  expect(screen.getByText('Enzo Le Fee')).toBeTruthy();
  expect(screen.queryByText(penalty.text)).toBeNull();
  expect(screen.getByRole('listitem').classList.contains('red')).toBe(false);
  expect(screen.getByRole('listitem').classList.contains('goal')).toBe(true);
});
it('makes card reasons and both substitution directions visible without commentary paragraphs', () => {
  render(
    <MatchEvents
      match={match}
      events={[
        { ...events[2], kind: 'yellow-card', participants: ['Booked player'], reason: 'Bad foul' },
        { ...events[0], participants: ['Incoming player', 'Outgoing player'], reason: 'Injury' },
      ]}
    />,
  );
  expect(screen.getByText('Yellow card · Bad foul')).toBeTruthy();
  expect(screen.getByText('On')).toBeTruthy();
  expect(screen.getByText('Off')).toBeTruthy();
  expect(screen.getByText('Incoming player')).toBeTruthy();
  expect(screen.getByText(/Outgoing player/)).toBeTruthy();
  expect(screen.getByText(/\(Injury\)/)).toBeTruthy();
});
it('orders stoppage-time events by the displayed minute when provider clocks disagree', () => {
  const stoppage: MatchSummary['events'] = [
    {
      id: 'four',
      minute: "90'+4'",
      period: 2,
      seconds: 5632,
      kind: 'shot-blocked',
      text: 'Blocked in 90+4',
      teamId: match.home.id,
    },
    {
      id: 'end',
      minute: "90'+6'",
      period: 2,
      seconds: 5400,
      kind: 'end-regular-time',
      text: 'Second half ends',
      teamId: null,
    },
    {
      id: 'one',
      minute: "90'+1'",
      period: 2,
      seconds: 5405,
      kind: 'offside',
      text: 'Offside in 90+1',
      teamId: match.home.id,
    },
    {
      id: 'three',
      minute: "90'+3'",
      period: 2,
      seconds: 5568,
      kind: 'foul',
      text: 'Foul in 90+3',
      teamId: match.away.id,
    },
  ];
  const text = () => screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent);
  const { unmount } = render(<MatchEvents match={match} events={stoppage} commentary newestFirst={false} />);
  expect(text()).toEqual(['Offside in 90+1', 'Foul in 90+3', 'Blocked in 90+4', 'Second half ends']);
  unmount();
  render(<MatchEvents match={match} events={stoppage} commentary newestFirst />);
  expect(text()).toEqual(['Second half ends', 'Blocked in 90+4', 'Foul in 90+3', 'Offside in 90+1']);
});

it("shows added time as 90+7' and labels the event team by crest rather than code", () => {
  const { container } = render(
    <MatchEvents
      match={match}
      events={[
        {
          id: 'a',
          minute: "90'+7'",
          period: 2,
          seconds: 5820,
          kind: 'foul',
          text: `Levi Colwill (${match.away.name}) wins a free kick.`,
          teamId: match.home.id,
        },
      ]}
      commentary
    />,
  );
  expect(screen.getByText("90+7'")).toBeTruthy();
  expect(container.querySelector('.event-team')?.getAttribute('aria-label')).toBe(match.home.name);
});
it('uses the committing side for a foul even when the provider tagged the fouled side', () => {
  const text = `Foul by Someone (${match.home.name}).`;
  const { container } = render(
    <MatchEvents
      match={match}
      events={[{ id: 'f', minute: "12'", period: 1, seconds: 720, kind: 'foul', text, teamId: match.away.id }]}
      commentary
    />,
  );
  expect(container.querySelector('.event')?.classList.contains('home')).toBe(true);
  expect(container.querySelector('.event-team')?.getAttribute('aria-label')).toBe(match.home.name);
});
it('draws a different icon for different kinds of event', () => {
  const kinds = [
    'goal',
    'shot-on-target',
    'shot-off-target',
    'foul',
    'corner',
    'offside',
    'yellow-card',
    'substitution',
    'var-decision',
    'kickoff',
    'halftime',
    'end-regular-time',
  ];
  const icons = kinds.map((kind, i) => {
    const { container, unmount } = render(
      <MatchEvents
        match={match}
        events={[{ id: String(i), minute: "1'", period: 1, seconds: 60, kind, text: kind, teamId: null }]}
        commentary
      />,
    );
    const svg = container.querySelector('.event-kind svg');
    const markup = svg?.innerHTML ?? '';
    unmount();
    return markup;
  });
  expect(new Set(icons).size).toBe(kinds.length);
});
it('gives a VAR row in compact view a headline and its detail', () => {
  render(
    <MatchEvents
      match={match}
      events={[
        {
          id: 'v',
          minute: "34'",
          period: 1,
          seconds: 2040,
          kind: 'var-decision',
          text: 'VAR Decision: Goal disallowed Matheus Cunha (Wolves).',
          teamId: match.home.id,
          participants: ['Matheus Cunha'],
        },
        {
          id: 'v2',
          minute: "61'",
          period: 2,
          seconds: 3660,
          kind: 'var-decision',
          text: 'VAR Decision: No penalty.',
          teamId: match.away.id,
        },
      ]}
    />,
  );
  expect(screen.getByText('VAR · Goal disallowed')).toBeTruthy();
  expect(screen.getByText('Matheus Cunha')).toBeTruthy();
  expect(screen.getByText('VAR · No penalty')).toBeTruthy();
  expect(screen.getByText('VAR Decision: No penalty.')).toBeTruthy();
});

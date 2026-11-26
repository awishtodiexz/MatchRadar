// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import raw from '../../tests/fixtures/summary-live-compact.json';
import { MatchLineups } from './MatchLineups';
import { mockSnapshot } from '../test-fixtures/fixtures';
import type { MatchSummary } from '../useMatchSummary';

const match = {
  ...mockSnapshot.matches[0],
  home: { id: '331', name: 'Brighton & Hove Albion', short: 'BHA' },
  away: { id: '337', name: 'Brentford', short: 'BRE' },
};
const players = raw.rosters.flatMap((team) =>
  team.roster.map((player) => ({
    teamId: team.team.id,
    name: player.athlete.displayName,
    position: player.position.abbreviation,
    jersey: player.jersey,
    starter: player.starter,
    formationPlace: Number(player.formationPlace) || undefined,
  })),
);
const formations = Object.fromEntries(raw.rosters.map((team) => [team.team.id, team.formation]));
const renderLineups = (extra: Partial<Parameters<typeof MatchLineups>[0]> = {}) =>
  render(<MatchLineups match={match} players={players} formations={formations} {...extra} />);
afterEach(cleanup);

it('keeps full-backs outside centre-backs and preserves the supplied midfield lines', () => {
  const { container } = renderLineups();
  const rows = [...container.querySelectorAll('.pitch-row')];
  const names = (row: Element) =>
    [...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
  expect(names(rows[3])).toEqual([
    expect.stringContaining('Olivier Boscagli'),
    expect.stringContaining('Lewis Dunk'),
    expect.stringContaining('Luka Vuskovic'),
    expect.stringContaining('Costinha'),
  ]);
  expect(names(rows[1])).toEqual([
    expect.stringContaining('Maxim De Cuyper'),
    expect.stringContaining('Yasin Ayari'),
    expect.stringContaining('Diego Gómez'),
  ]);
  expect(names(rows[2])).toEqual([expect.stringContaining('Chema Andrés'), expect.stringContaining('Pascal Gross')]);
});

it('orders a five-player defence and falls back to formation slots for ambiguous positions', () => {
  const positions = ['G', 'RB', 'CD-R', 'LB', 'CD-L', 'CD', 'CM', 'CM', 'CM', 'CF', 'CF'];
  const squad = positions.map((position, index) => ({
    teamId: match.home.id,
    name: `Player ${index + 1}`,
    position,
    starter: true,
    jersey: String(index + 1),
    formationPlace: index + 1,
  }));
  const { container, rerender } = renderLineups({ players: squad, formations: { [match.home.id]: '5-3-2' } });
  const defenderNumbers = () =>
    [...container.querySelectorAll('.pitch-row')[2].querySelectorAll('.pitch-shirt')].map((shirt) => shirt.textContent);
  expect(defenderNumbers()).toEqual(['4', '5', '6', '3', '2']);
  rerender(
    <MatchLineups
      match={match}
      players={squad.map((player) =>
        player.position === 'G' ? player : { ...player, position: player.formationPlace <= 6 ? 'CD' : player.position },
      )}
      formations={{ [match.home.id]: '5-3-2' }}
    />,
  );
  expect(defenderNumbers()).toEqual(['2', '3', '4', '5', '6']);
});

it('preserves compound surnames and exposes full player names by focus and tap', () => {
  const { container } = renderLineups();
  const player = screen.getByRole('button', { name: /#29 Maxim De Cuyper/ });
  expect(within(player).getByText('M. De Cuyper')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Chema Andrés/ }).textContent).toContain('C. Andrés');
  fireEvent.focus(player);
  expect(container.querySelector('.pitch-inspection')?.textContent).toContain('Maxim De Cuyper');
  expect(player.getAttribute('aria-describedby')).toBe(container.querySelector('.pitch-inspection')?.id);
  fireEvent.keyDown(player, { key: 'Escape' });
  expect(container.querySelector('.pitch-inspection')).toBeNull();
  fireEvent.click(player);
  expect(container.querySelector('.pitch-inspection')?.textContent).toContain('#29 · AM-L');
  fireEvent.blur(player);
  expect(container.querySelector('.pitch-inspection')).toBeNull();
});

it('labels kickoff positions, collapses the full roster and resets inspection when switching teams', () => {
  const { container } = renderLineups();
  expect(screen.getByRole('group', { name: 'Brighton & Hove Albion starting XI at kickoff' })).toBeTruthy();
  expect(screen.getByText(/not a live tactical view/)).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Brighton & Hove Albion 20 players' })).toBeTruthy();
  const roster = container.querySelector('details');
  expect(roster?.open).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Maxim De Cuyper/ }));
  fireEvent.keyDown(screen.getByRole('tab', { name: /Brighton/ }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Brentford/ }).getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('.pitch-inspection')).toBeNull();
  expect(screen.getByRole('group', { name: 'Brentford starting XI at kickoff' })).toBeTruthy();
});

it('mirrors goals and cards in the full roster and separates used from unused substitutes', () => {
  const events: MatchSummary['events'] = [
    {
      id: 'goal',
      minute: "23'",
      period: 1,
      seconds: 1380,
      kind: 'goal',
      text: 'Goal',
      teamId: match.home.id,
      participants: ['Charalambos Kostoulas'],
    },
    {
      id: 'card',
      minute: "45+2'",
      period: 1,
      seconds: 2820,
      kind: 'yellow-card',
      text: 'Yellow card',
      teamId: match.home.id,
      participants: ['Lewis Dunk'],
    },
  ];
  const { container } = renderLineups({
    events,
    substitutions: [{ teamId: match.home.id, playerIn: 'Mats Wieffer', playerOut: 'Chema Andrés', minute: "60'" }],
  });
  expect(screen.getByRole('button', { name: /Kostoulas.*Goal 23'/ })).toBeTruthy();
  expect(screen.getByText("Goal 23'")).toBeTruthy();
  expect(screen.getByText("Yellow card 45+2'")).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Used substitutes · 1' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Unused bench · 8' })).toBeTruthy();
  expect(container.querySelector('.bench-list li')?.textContent).toContain('for Chema Andrés');
  expect(container.querySelector('.bench-list li .sub-marker.on')?.textContent).toBe("↑ 60'");
  expect(screen.getByText(/Ball = goal/)).toBeTruthy();
});

it.each(['formation', 'slots', 'partial'] as const)(
  'keeps a readable list when %s data cannot support a pitch',
  (reason) => {
    const squad =
      reason === 'partial'
        ? players.filter((player) => player.name !== 'Lewis Dunk')
        : reason === 'slots'
          ? players.map((player) => ({ ...player, formationPlace: undefined }))
          : players;
    const { container } = renderLineups({ players: squad, formations: reason === 'formation' ? {} : formations });
    expect(container.querySelector('.lineup-pitch')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Goalkeepers' })).toBeTruthy();
    expect(screen.getByText('Maxim De Cuyper')).toBeTruthy();
  },
);

it('uses a singular player count on a team tab', () => {
  renderLineups({
    players: [{ teamId: match.home.id, name: 'Solo Player', position: 'GK', starter: true }],
    formations: {},
  });
  expect(screen.getByRole('tab', { name: /Brighton & Hove Albion 1 player$/ })).toBeTruthy();
});

it('explains an unavailable squad without inventing players or a formation', () => {
  const { container } = renderLineups({ players: [], formations: {} });
  expect(screen.getByText('Lineup unavailable')).toBeTruthy();
  expect(screen.getAllByRole('tab').every((tab) => tab.textContent?.includes('No lineup'))).toBe(true);
  expect(container.querySelector('.pitch-player')).toBeNull();
});

it('keeps mirrored side forwards together behind a central striker in a 3-4-2-1', () => {
  const positions = ['G', 'CB', 'CB', 'CB', 'CM', 'CM', 'CM', 'CM', 'F', 'CF-R', 'CF-L'];
  const squad = positions.map((position, index) => ({
    teamId: match.home.id,
    name: `Player ${index + 1}`,
    position,
    starter: true,
    jersey: String(index + 1),
    formationPlace: index + 1,
  }));
  const { container } = renderLineups({ players: squad, formations: { [match.home.id]: '3-4-2-1' } });
  const rows = [...container.querySelectorAll('.pitch-row')];
  const names = (row: Element) =>
    [...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
  expect(names(rows[0])).toEqual([expect.stringContaining('Player 9')]);
  expect(names(rows[1])).toEqual([expect.stringContaining('Player 11'), expect.stringContaining('Player 10')]);
});

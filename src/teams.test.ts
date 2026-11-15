import { describe, expect, it } from 'vitest';
import { clubs, competitionLogoCandidates, crestCandidates } from './teams';

const combiner = (path: string) => `https://a.espncdn.com/combiner/i?img=${path}&w=96&h=96`;
const canonical = (id: string) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;

describe('club crests', () => {
  it('uses corrected canonical IDs for Fulham and West Ham', () => {
    for (const [name, id] of [
      ['Fulham', '370'],
      ['West Ham United', '371'],
    ]) {
      const club = clubs.find((team) => team.name === name);
      expect(club?.id).toBe(id);
      expect(club && crestCandidates(club)).toEqual([combiner(`/i/teamlogos/soccer/500/${id}.png`), canonical(id)]);
    }
  });
  it('rejects untrusted and credential-bearing provider URLs', () => {
    expect(
      crestCandidates({ id: '370', name: 'Fulham', short: 'FUL', logo: 'https://user@a.espncdn.com/logo.png' }),
    ).toEqual([combiner('/i/teamlogos/soccer/500/370.png'), canonical('370')]);
    expect(
      crestCandidates({ id: 'custom', name: 'Club', short: 'CLB', logo: 'https://evil.example/logo.png' }),
    ).toEqual([]);
  });
  it('ignores a provider logo that belongs to another club', () => {
    expect(
      crestCandidates({
        id: '370',
        name: 'Fulham',
        short: 'FUL',
        logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/371.png',
      }),
    ).toEqual([combiner('/i/teamlogos/soccer/500/370.png'), canonical('370')]);
    expect(
      crestCandidates({
        id: '370',
        name: 'Fulham',
        short: 'FUL',
        logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/370.png',
      }),
    ).toEqual([combiner('/i/teamlogos/soccer/500/370.png'), canonical('370')]);
  });
  it('takes the small dark crest before the light and raw fallbacks without duplicates', () => {
    expect(
      crestCandidates(
        {
          id: '367',
          name: 'Tottenham Hotspur',
          short: 'TOT',
          logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
        },
        'dark',
      ),
    ).toEqual([
      combiner('/i/teamlogos/soccer/500-dark/367.png'),
      combiner('/i/teamlogos/soccer/500/367.png'),
      canonical('367'),
    ]);
  });
});
describe('competition badges', () => {
  it('uses ESPN league logo ids for both competitions', () => {
    expect(competitionLogoCandidates('premierLeague', 'light')).toEqual([
      combiner('/i/leaguelogos/soccer/500/23.png'),
      combiner('/i/leaguelogos/soccer/500-dark/23.png'),
    ]);
    expect(competitionLogoCandidates('championsLeague', 'light')).toEqual([
      combiner('/i/leaguelogos/soccer/500/2.png'),
      combiner('/i/leaguelogos/soccer/500-dark/2.png'),
    ]);
  });
  it('prefers the dark badge variant in the dark theme and keeps a light fallback', () => {
    expect(competitionLogoCandidates('premierLeague', 'dark')).toEqual([
      combiner('/i/leaguelogos/soccer/500-dark/23.png'),
      combiner('/i/leaguelogos/soccer/500/23.png'),
    ]);
  });
});

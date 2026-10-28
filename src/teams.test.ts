import { describe, expect, it } from 'vitest';
import { clubs, crestCandidates } from './teams';
describe('club crests', () => {
 it('uses corrected canonical IDs for Fulham and West Ham', () => {
  for (const [name, id] of [['Fulham','370'], ['West Ham United','371']]) {
   const club = clubs.find(team => team.name === name);
   expect(club?.id).toBe(id);
   expect(club && crestCandidates(club)).toEqual([`https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`]);
  }
 });
 it('rejects untrusted and credential-bearing provider URLs', () => {
  expect(crestCandidates({id:'370', name:'Fulham', short:'FUL', logo:'https://user@a.espncdn.com/logo.png'})).toEqual(['https://a.espncdn.com/i/teamlogos/soccer/500/370.png']);
  expect(crestCandidates({id:'custom', name:'Club', short:'CLB', logo:'https://evil.example/logo.png'})).toEqual([]);
 });
 it('tries the dark crest variant before the canonical fallback without duplicates', () => {
  expect(crestCandidates({id:'367', name:'Tottenham Hotspur', short:'TOT', logo:'https://a.espncdn.com/i/teamlogos/soccer/500/367.png'}, 'dark')).toEqual([
   'https://a.espncdn.com/i/teamlogos/soccer/500-dark/367.png',
   'https://a.espncdn.com/i/teamlogos/soccer/500/367.png'
  ]);
 });
});

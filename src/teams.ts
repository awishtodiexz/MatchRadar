import type { Team } from './types';

export const clubs: Team[] = [
  ['359','Arsenal','ARS'],['363','Chelsea','CHE'],['364','Liverpool','LIV'],['382','Manchester City','MCI'],['360','Manchester United','MUN'],['367','Tottenham Hotspur','TOT'],['368','Everton','EVE'],['362','Aston Villa','AVL'],['361','Newcastle United','NEW'],['331','Brighton & Hove Albion','BHA'],['380','Wolverhampton Wanderers','WOL'],['371','West Ham United','WHU'],['384','Crystal Palace','CRY'],['370','Fulham','FUL'],['337','Brentford','BRE'],['393','Nottingham Forest','NFO'],['357','Leeds United','LEE'],['366','Sunderland','SUN'],['379','Burnley','BUR'],['349','Bournemouth','BOU'],['388','Coventry City','COV'],['306','Hull City','HUL'],['373','Ipswich Town','IPS']
].map(([id,name,short]) => ({id,name,short}));

export function crestCandidates(team: Team, theme: 'dark' | 'light' = 'light'): string[] {
  const urls: string[] = [];
  if (theme === 'dark' && /^\d+$/.test(team.id)) {
    urls.push(`https://a.espncdn.com/i/teamlogos/soccer/500-dark/${team.id}.png`);
  }
  if (team.logo) {
    try {
      const url = new URL(team.logo);
      if (url.protocol === 'https:' && url.hostname === 'a.espncdn.com' && !url.username && !url.password && !url.port) urls.push(url.href);
    } catch { /* Invalid provider URLs use the canonical crest. */ }
  }
  if (/^\d+$/.test(team.id)) urls.push(`https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`);
  return [...new Set(urls)];
}

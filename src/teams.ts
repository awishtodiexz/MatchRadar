import type { Team } from './types';

export const clubs: Team[] = [
  ['359', 'Arsenal', 'ARS'],
  ['363', 'Chelsea', 'CHE'],
  ['364', 'Liverpool', 'LIV'],
  ['382', 'Manchester City', 'MCI'],
  ['360', 'Manchester United', 'MUN'],
  ['367', 'Tottenham Hotspur', 'TOT'],
  ['368', 'Everton', 'EVE'],
  ['362', 'Aston Villa', 'AVL'],
  ['361', 'Newcastle United', 'NEW'],
  ['331', 'Brighton & Hove Albion', 'BHA'],
  ['380', 'Wolverhampton Wanderers', 'WOL'],
  ['371', 'West Ham United', 'WHU'],
  ['384', 'Crystal Palace', 'CRY'],
  ['370', 'Fulham', 'FUL'],
  ['337', 'Brentford', 'BRE'],
  ['393', 'Nottingham Forest', 'NFO'],
  ['357', 'Leeds United', 'LEE'],
  ['366', 'Sunderland', 'SUN'],
  ['379', 'Burnley', 'BUR'],
  ['349', 'Bournemouth', 'BOU'],
  ['388', 'Coventry City', 'COV'],
  ['306', 'Hull City', 'HUL'],
  ['373', 'Ipswich Town', 'IPS'],
].map(([id, name, short]) => ({ id, name, short }));

// 96px covers the largest badge (38px) at 2x DPI. The raw 500px asset is ~35KB,
// the combiner version ~4-9KB, which matters for a list of match cards.
const crestSize = 96;
const combined = (path: string) => `https://a.espncdn.com/combiner/i?img=${path}&w=${crestSize}&h=${crestSize}`;

// A crest must identify the same team. ESPN logo files are named by team id,
// so a shuffled or malformed response cannot make a club wear another badge.
function crestBelongsTo(url: URL, id: string): boolean {
  if (!/^\d+$/.test(id)) return false;
  const file = url.pathname.split('/').pop() ?? '';
  const stem = file.split('.')[0];
  return stem === id || stem.startsWith(`${id}-`);
}

export function crestCandidates(team: Team, theme: 'dark' | 'light' = 'light'): string[] {
  const urls: string[] = [];
  if (/^\d+$/.test(team.id)) {
    urls.push(combined(`/i/teamlogos/soccer/500${theme === 'dark' ? '-dark' : ''}/${team.id}.png`));
    if (theme === 'dark') urls.push(combined(`/i/teamlogos/soccer/500/${team.id}.png`));
  }
  if (team.logo) {
    try {
      const url = new URL(team.logo);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'a.espncdn.com' &&
        !url.username &&
        !url.password &&
        !url.port &&
        crestBelongsTo(url, team.id)
      )
        urls.push(url.href);
    } catch {
      /* Invalid provider URLs use the canonical crest. */
    }
  }
  if (/^\d+$/.test(team.id)) urls.push(`https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`);
  return [...new Set(urls)];
}

// ESPN league logo ids: 23 = English Premier League, 2 = UEFA Champions League.
const competitionLogoIds = { premierLeague: '23', championsLeague: '2' } as const;

export function competitionLogoCandidates(
  league: 'premierLeague' | 'championsLeague',
  theme: 'dark' | 'light' = 'dark',
): string[] {
  const id = competitionLogoIds[league];
  const base = `/i/leaguelogos/soccer/500/${id}.png`;
  const dark = `/i/leaguelogos/soccer/500-dark/${id}.png`;
  return (theme === 'dark' ? [dark, base] : [base, dark]).map(combined);
}

const clubCodes = new Map(clubs.map((club) => [club.id, club.short]));
// ESPN abbreviates both Manchester clubs as "MAN" in some feeds; known clubs use
// their unambiguous three-letter code, anything else keeps the provider's.
export const teamCode = (team: Team) => clubCodes.get(team.id) ?? team.short;

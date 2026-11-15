export const isVarReview = (kind: string) => /^var(?:-|$)/i.test(kind);
export const isGoal = (kind: string) =>
  /^(goal(?:---.+)?|own-goal|penalty-scored|penalty---scored)$/i.test(kind) &&
  !/disallowed|cancelled|overturned/i.test(kind);
export const isCard = (kind: string) => /^(yellow-card|red-card|second-yellow(?:-card)?)$/i.test(kind);
export const isSubstitution = (kind: string) => kind === 'substitution';
export const isIncident = (kind: string) =>
  isGoal(kind) ||
  isCard(kind) ||
  isSubstitution(kind) ||
  /^penalty-(?:--)?(?:missed|saved)$/i.test(kind) ||
  isVarReview(kind);
export const keyEvent = (kind: string) =>
  isIncident(kind) || /^(kickoff|half-?time|full-?time|start-2nd-half|end-regular-time)$/i.test(kind);

const LABELS: Record<string, string> = {
  'penalty---scored': 'Penalty scored',
  'penalty---missed': 'Penalty missed',
  'penalty---saved': 'Penalty saved',
  'goal---header': 'Header goal',
  'second-yellow-card': 'Second yellow card',
  'second-yellow': 'Second yellow card',
  'start-delay': 'Play stopped',
  'end-delay': 'Play resumed',
  'pre-match': 'Before kick-off',
  'full-time': 'Full-time',
  'half-time': 'Half-time',
  halftime: 'Half-time',
  'end-regular-time': 'Full-time',
  'start-2nd-half': 'Second half',
  kickoff: 'Kick-off',
};

export const eventLabel = (kind: string) => {
  const known = LABELS[kind];
  if (known) return known;
  if (isVarReview(kind)) {
    const detail = kind
      .replace(/^var-+/i, '')
      .replace(/-+/g, ' ')
      .trim();
    return detail ? `VAR review · ${detail.replace(/^./, (letter) => letter.toUpperCase())}` : 'VAR review';
  }
  return kind.replace(/-+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) || 'Commentary';
};

/** One icon identity per kind of commentary; MatchEvents maps these to lucide glyphs. */
export type EventIconKey =
  | 'goal'
  | 'penalty-miss'
  | 'card-yellow'
  | 'card-red'
  | 'substitution'
  | 'var'
  | 'kickoff'
  | 'half-time'
  | 'full-time'
  | 'delay'
  | 'injury'
  | 'corner'
  | 'offside'
  | 'foul'
  | 'free-kick'
  | 'save'
  | 'shot-blocked'
  | 'shot-off'
  | 'shot-on'
  | 'woodwork'
  | 'pre-match'
  | 'commentary';
export const eventIconKey = (kind: string): EventIconKey => {
  const k = kind.toLowerCase();
  if (isGoal(k)) return 'goal';
  if (/^penalty-(?:--)?(?:missed|saved)$/.test(k)) return 'penalty-miss';
  if (isCard(k) || /card/.test(k)) return /red|second-yellow/.test(k) ? 'card-red' : 'card-yellow';
  if (isSubstitution(k) || /^sub/.test(k)) return 'substitution';
  if (isVarReview(k)) return 'var';
  if (/^(kickoff|start-2nd-half|start-extra|start-\d)/.test(k)) return 'kickoff';
  if (/^half-?time$|^end-1st-half|^end-first-half/.test(k)) return 'half-time';
  if (/^(full-?time|end-regular-time|end-extra-time|end-match)/.test(k)) return 'full-time';
  if (/injur/.test(k)) return 'injury';
  if (/delay/.test(k)) return 'delay';
  if (/corner/.test(k)) return 'corner';
  if (/offside/.test(k)) return 'offside';
  if (/free-?kick/.test(k)) return 'free-kick';
  if (/foul|handball/.test(k)) return 'foul';
  if (/woodwork|hit-?post|hit-?bar|crossbar/.test(k)) return 'woodwork';
  if (/save/.test(k)) return 'save';
  if (/block/.test(k)) return 'shot-blocked';
  if (/shot.*(off|wide|miss)|attempt.*(off|wide|miss)|off-target/.test(k)) return 'shot-off';
  if (/shot|attempt|chance|saved/.test(k)) return 'shot-on';
  if (/^(pre-match|lineups?)/.test(k)) return 'pre-match';
  return 'commentary';
};

interface Side {
  id: string;
  name: string;
  short: string;
}
const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const sideFor = (name: string, sides: Side[]) => {
  const wanted = norm(name);
  return wanted
    ? sides.find((side) =>
        [side.name, side.short].some((label) => {
          const own = norm(label);
          return !!own && (own === wanted || own.includes(wanted) || wanted.includes(own));
        }),
      )
    : undefined;
};
/**
 * The side an event belongs to. ESPN attaches a foul to the side that gave it
 * away, but its prose is written from the fouled player's view ("X (Chelsea)
 * wins a free kick"), so read the parenthesised club out of the text and trust
 * it over the supplied team when the two disagree.
 */
export const eventTeamId = (event: { kind: string; text: string; teamId: string | null }, home: Side, away: Side) => {
  if (eventIconKey(event.kind) !== 'foul') return event.teamId;
  const sides = [home, away];
  const committer = /\bfoul by [^()]*\(([^)]+)\)/i.exec(event.text)?.[1];
  const fouled = /\(([^)]+)\)\s+wins a (?:free kick|penalty)/i.exec(event.text)?.[1];
  const by = committer && sideFor(committer, sides);
  if (by) return by.id;
  const won = fouled && sideFor(fouled, sides);
  if (won) return won.id === home.id ? away.id : home.id;
  return event.teamId;
};

const VAR_OUTCOME =
  /\b(goal (?:disallowed|cancelled|canceled|ruled out|awarded|confirmed|stands)|no goal|penalty (?:awarded|cancelled|canceled|overturned|confirmed)|no penalty|(?:red |yellow )?card (?:upgraded|downgraded|cancelled|canceled|overturned|rescinded|awarded)|offside (?:confirmed|overturned)|decision (?:stands|overturned|upheld))\b/i;
const capital = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase());
/** A readable headline for a VAR row: "VAR · Goal disallowed", falling back to the kind, then "VAR review". */
export const varLabel = (kind: string, text = '') => {
  const outcome = VAR_OUTCOME.exec(text)?.[1];
  if (outcome) return `VAR · ${capital(outcome.toLowerCase())}`;
  const detail = kind
    .replace(/^var(?:-+|$)/i, '')
    .replace(/-+/g, ' ')
    .trim();
  return detail && !/^(?:decision|review|check)$/i.test(detail) ? `VAR · ${capital(detail)}` : 'VAR review';
};

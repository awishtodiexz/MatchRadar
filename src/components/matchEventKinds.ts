export const isVarReview = (kind:string) => /^var(?:-|$)/i.test(kind);
export const isGoal = (kind:string) => /^(goal(?:---.+)?|own-goal|penalty-scored|penalty---scored)$/i.test(kind)&&!/disallowed|cancelled|overturned/i.test(kind);
export const isCard = (kind:string) => /^(yellow-card|red-card|second-yellow(?:-card)?)$/i.test(kind);
export const isSubstitution = (kind:string) => kind==='substitution';
export const isIncident = (kind:string) => isGoal(kind)||isCard(kind)||isSubstitution(kind)||/^penalty-(?:--)?(?:missed|saved)$/i.test(kind)||isVarReview(kind);
export const keyEvent = (kind:string) => isIncident(kind)||/^(kickoff|half-?time|full-?time|start-2nd-half|end-regular-time)$/i.test(kind);

const LABELS:Record<string,string> = {
  'penalty---scored':'Penalty scored','penalty---missed':'Penalty missed','penalty---saved':'Penalty saved',
  'goal---header':'Header goal','second-yellow-card':'Second yellow card','second-yellow':'Second yellow card',
  'start-delay':'Play stopped','end-delay':'Play resumed','pre-match':'Before kick-off',
  'full-time':'Full-time','half-time':'Half-time','halftime':'Half-time','end-regular-time':'Full-time',
  'start-2nd-half':'Second half','kickoff':'Kick-off',
};

export const eventLabel = (kind:string) => {
  const known=LABELS[kind];
  if(known) return known;
  if(isVarReview(kind)) {
    const detail=kind.replace(/^var-+/i,'').replace(/-+/g,' ').trim();
    return detail?`VAR review · ${detail.replace(/^./,letter=>letter.toUpperCase())}`:'VAR review';
  }
  return kind.replace(/-+/g,' ').replace(/^./,letter=>letter.toUpperCase())||'Commentary';
};

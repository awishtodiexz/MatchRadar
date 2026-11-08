export const isGoal = (kind:string) => /^(goal(?:---.+)?|own-goal|penalty-scored|penalty---scored)$/i.test(kind)&&!/disallowed|cancelled|overturned/i.test(kind);
export const isCard = (kind:string) => /^(yellow-card|red-card|second-yellow(?:-card)?)$/i.test(kind);
export const isSubstitution = (kind:string) => kind==='substitution';
export const isIncident = (kind:string) => isGoal(kind)||isCard(kind)||isSubstitution(kind)||/^penalty-(?:--)?(?:missed|saved)$/i.test(kind)||/^var-(?:goal|penalty|red-card|decision)/i.test(kind);
export const keyEvent = (kind:string) => isIncident(kind)||/^(kickoff|half-time|full-time|var.*)$/i.test(kind);
export const eventLabel = (kind:string) => ({'penalty---scored':'Penalty scored','penalty---missed':'Penalty missed','penalty---saved':'Penalty saved','goal---header':'Header goal','second-yellow-card':'Second yellow card','second-yellow':'Second yellow card','start-delay':'Play stopped','end-delay':'Play resumed','pre-match':'Before kick-off','full-time':'Full-time','half-time':'Half-time','kickoff':'Kick-off'}[kind]||kind.replace(/-+/g,' ').replace(/^./,letter=>letter.toUpperCase())||'Commentary');

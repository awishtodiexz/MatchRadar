import type { Match } from '../types';
export const DEMO_STAGES=['Scheduled','First half','Half-time','Second half','Full-time'] as const;
// UI-only derived scenario. It never changes the native feed, settings or alert state.
export function progressDemo(matches:Match[],step:number):Match[] {
 if(step<=0)return matches;
 return matches.map(m=>{
  if(m.home.id!=='382'||m.away.id!=='360')return m;
  const stage=Math.min(4,Math.max(1,Math.floor(step)));
  const values=[null,{status:'live',detail:"20'",homeScore:0,awayScore:0},{status:'halftime',detail:'Half-time',homeScore:1,awayScore:0},{status:'live',detail:"70'",homeScore:1,awayScore:1},{status:'fulltime',detail:'Full-time',homeScore:2,awayScore:1}] as const;
  return {...m,...values[stage]};
 });
}

// Clock advances with the selected scenario; kickoff itself never changes during a session.
export function demoClock(match:Match|undefined,step:number):string|null {
 if(!match)return null;const kickoff=Date.parse(match.kickoff);if(!Number.isFinite(kickoff))return null;
 const minutes=[-15,20,47,70,94][Math.min(4,Math.max(0,Math.floor(step)))];
 return new Date(kickoff+minutes*60000).toISOString();
}

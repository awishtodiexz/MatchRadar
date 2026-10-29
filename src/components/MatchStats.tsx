import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

export function MatchStats({match,statistics}:{match:Match;statistics:MatchSummary['statistics']}) {
  const keys=[...new Set(statistics.filter(s=>s.teamId===match.home.id||s.teamId===match.away.id).map(s=>s.name))];
  return <div className="stat-comparison" role="table" aria-label="Team statistics">
    <div className="stat-heading" role="row"><strong role="columnheader">{match.home.name}</strong><span role="columnheader">Statistic</span><strong role="columnheader">{match.away.name}</strong></div>
    {keys.map(key=>{
      const home=statistics.find(s=>s.name===key&&s.teamId===match.home.id);
      const away=statistics.find(s=>s.name===key&&s.teamId===match.away.id);
      const comparable=['possession','possessionPct','shots','totalShots','shotsOnTarget','corners','wonCorners'].includes(key);
      const number=(value:string|undefined)=>value&&/^\d+(?:\.\d+)?%?$/.test(value.trim())?Number.parseFloat(value):null;
      const left=number(home?.value),right=number(away?.value);
      const highlight=comparable&&left!==null&&right!==null;
      return <div className="stat-row" role="row" key={key}><span role="cell" className={highlight&&left>right?'stat-leading':undefined}>{home?.value??'—'}</span><span role="cell">{home?.label||away?.label||key}</span><span role="cell" className={highlight&&right>left?'stat-leading':undefined}>{away?.value??'—'}</span></div>;
    })}
  </div>;
}

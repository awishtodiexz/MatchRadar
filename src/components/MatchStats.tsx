import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

type Stat = MatchSummary['statistics'][number];
type Pair = { name:string; home?:Stat; away?:Stat };

const SECTIONS: {title:string; keys:string[]}[] = [
  {title:'Match',keys:['possessionPct','totalShots','shotsOnTarget','shotPct','wonCorners']},
  {title:'Attack',keys:['blockedShots','penaltyKickGoals','penaltyKickShots']},
  {title:'Passing',keys:['totalPasses','accuratePasses','passPct','totalCrosses','accurateCrosses','crossPct','totalLongBalls','accurateLongBalls','longballPct']},
  {title:'Defending',keys:['totalTackles','effectiveTackles','tacklePct','interceptions','totalClearance','effectiveClearance','saves']},
  {title:'Discipline',keys:['foulsCommitted','offsides','yellowCards','redCards']},
];

const LABELS: Record<string,string> = {
  possessionPct:'Possession',totalShots:'Shots',shotsOnTarget:'On target',shotPct:'Shot accuracy',
  blockedShots:'Blocked shots',wonCorners:'Corners',penaltyKickGoals:'Penalty goals',penaltyKickShots:'Penalty kicks',
  totalPasses:'Passes',accuratePasses:'Accurate passes',passPct:'Pass completion',
  totalCrosses:'Crosses',accurateCrosses:'Accurate crosses',crossPct:'Cross completion',
  totalLongBalls:'Long balls',accurateLongBalls:'Accurate long balls',longballPct:'Long ball completion',
  totalTackles:'Tackles',effectiveTackles:'Effective tackles',tacklePct:'Tackle success',
  interceptions:'Interceptions',totalClearance:'Clearances',effectiveClearance:'Effective clearances',saves:'Saves',
  foulsCommitted:'Fouls',offsides:'Offsides',yellowCards:'Yellow cards',redCards:'Red cards',
};

const NEGATIVE = new Set(['foulsCommitted','yellowCards','redCards','offsides']);

const numeric = (value?:string) => {
  if(!value) return null;
  const cleaned = value.trim().replace(/[,\s%]/g,'');
  if(!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number.parseFloat(cleaned);
};

const scale = (name:string, value:number) => name.endsWith('Pct') && value > 0 && value <= 1 ? value * 100 : value;

const shown = (name:string, stat?:Stat) => {
  if(!stat) return '—';
  if(name.endsWith('Pct')) {
    const value = numeric(stat.value);
    if(value !== null) {
      const pct = scale(name,value);
      return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(1))}%`;
    }
  }
  return stat.value;
};

export function MatchStats({match,statistics}:{match:Match;statistics:MatchSummary['statistics']}) {
  const byName = new Map<string,Pair>();
  for(const stat of statistics) {
    if(stat.teamId!==match.home.id && stat.teamId!==match.away.id) continue;
    const pair = byName.get(stat.name) ?? {name:stat.name};
    if(stat.teamId===match.home.id) pair.home = stat; else pair.away = stat;
    byName.set(stat.name,pair);
  }
  const listed = new Set(SECTIONS.flatMap(section=>section.keys));
  const sections = SECTIONS.map(section=>({
    title:section.title,
    rows:section.keys.map(key=>byName.get(key)).filter((pair):pair is Pair=>Boolean(pair)),
  })).filter(section=>section.rows.length>0);
  const extras = [...byName.values()].filter(pair=>!listed.has(pair.name));
  if(extras.length) sections.push({title:'Other',rows:extras});

  if(!sections.length) return <p className="field-note">Statistics are not available for this match.</p>;

  return <div className="stat-comparison" role="table" aria-label="Team statistics">
    <div className="sr-only" role="row"><strong role="columnheader">{match.home.name}</strong><span role="columnheader">Statistic</span><strong role="columnheader">{match.away.name}</strong></div>
    {sections.map(section=><div className="stat-section" role="rowgroup" key={section.title}>
      <div className="stat-section-title" role="row"><span role="columnheader" aria-colspan={3}>{section.title}</span></div>
      {section.rows.map(pair=>{
        const left=numeric(pair.home?.value),right=numeric(pair.away?.value);
        const leftValue=left===null?null:scale(pair.name,left),rightValue=right===null?null:scale(pair.name,right);
        const comparable=leftValue!==null&&rightValue!==null;
        const peak=comparable?Math.max(leftValue,rightValue):0;
        const leftWidth=comparable&&peak>0?Math.round((leftValue/peak)*100):0;
        const rightWidth=comparable&&peak>0?Math.round((rightValue/peak)*100):0;
        const homeLeads=comparable&&!NEGATIVE.has(pair.name)&&leftValue>rightValue;
        const awayLeads=comparable&&!NEGATIVE.has(pair.name)&&rightValue>leftValue;
        return <div className="stat-row" role="row" key={pair.name}>
          <span role="cell" className={homeLeads?'stat-leading':undefined}>{shown(pair.name,pair.home)}</span>
          <span role="cell">{LABELS[pair.name]||pair.home?.label||pair.away?.label||pair.name}</span>
          <span role="cell" className={awayLeads?'stat-leading':undefined}>{shown(pair.name,pair.away)}</span>
          {comparable&&<div className="stat-bar" aria-hidden="true"><span className={'bar-home '+(homeLeads?'winning':'')}><i style={{width:`${leftWidth}%`}}/></span><span className={'bar-away '+(awayLeads?'winning':'')}><i style={{width:`${rightWidth}%`}}/></span></div>}
        </div>;
      })}
    </div>)}
  </div>;
}

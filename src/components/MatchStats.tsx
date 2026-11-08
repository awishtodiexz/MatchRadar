import { useState } from 'react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

type Stat = MatchSummary['statistics'][number];
type Pair = { name:string; home?:Stat; away?:Stat };

const SECTIONS: {title:string; keys:string[]}[] = [
  {title:'Match',keys:['expectedGoals','possessionPct','totalShots','shotsOnTarget','bigChanceCreated','wonCorners']},
  {title:'Attack',keys:['expectedGoalsNonPenalty','expectedGoalsOnTarget','expectedAssists','shotsOffTarget','blockedShots','shotPct','attemptsIbox','attemptsObox','hitWoodwork','bigChanceMissed','touchesInOppBox','finalThirdEntries','penAreaEntries','penaltyKickGoals','penaltyKickShots','totalContest','wonContest']},
  {title:'Passing',keys:['totalPasses','accuratePasses','passPct','totalCrosses','accurateCrosses','crossPct','totalLongBalls','accurateLongBalls','longballPct','totalThroughBalls','accurateThroughBalls','totalFinalThirdPasses','successfulFinalThirdPasses','shotAssists','touches']},
  {title:'Defending',keys:['duels','duelsWon','duelsLost','duelWinPct','aerialsWon','aerialsLost','aerialDuelPct','totalTackles','effectiveTackles','tacklePct','interceptions','totalClearance','effectiveClearance','ballRecovery','possWonAtt3rd','possWonMid3rd','possWonDef3rd','ppda','dispossessed']},
  {title:'Goalkeeping',keys:['saves','goalsPrevented','expectedGoalsOnTargetConceded','crossesCaught','punches','accurateKeeperSweeper']},
  {title:'Discipline',keys:['foulsCommitted','foulsSuffered','offsides','yellowCards','secondYellow','redCards']},
];

const LABELS: Record<string,string> = {
  expectedGoals:'Expected goals (xG)',expectedGoalsNonPenalty:'Non-penalty xG',expectedGoalsOnTarget:'Expected goals on target (xGOT)',expectedAssists:'Expected assists (xA)',
  bigChanceCreated:'Big chances created',bigChanceMissed:'Big chances missed',shotsOffTarget:'Off target',attemptsIbox:'Shots inside box',attemptsObox:'Shots outside box',hitWoodwork:'Hit woodwork',touchesInOppBox:'Touches in opposition box',finalThirdEntries:'Final-third entries',penAreaEntries:'Penalty-area entries',totalContest:'Dribbles attempted',wonContest:'Dribbles completed',
  totalThroughBalls:'Through balls',accurateThroughBalls:'Accurate through balls',totalFinalThirdPasses:'Final-third passes',successfulFinalThirdPasses:'Accurate final-third passes',shotAssists:'Chances created',touches:'Touches',
  duels:'Duels contested',duelsWon:'Duels won',duelsLost:'Duels lost',duelWinPct:'Duels won %',aerialsWon:'Aerial duels won',aerialsLost:'Aerial duels lost',aerialDuelPct:'Aerial duels won %',ballRecovery:'Ball recoveries',possWonAtt3rd:'Possession won · attacking third',possWonMid3rd:'Possession won · middle third',possWonDef3rd:'Possession won · defensive third',ppda:'Passes per defensive action',dispossessed:'Dispossessed',
  goalsPrevented:'Goals prevented',expectedGoalsOnTargetConceded:'xGOT faced',crossesCaught:'Crosses caught',punches:'Punches',accurateKeeperSweeper:'Sweeper actions',foulsSuffered:'Fouls won',secondYellow:'Second yellow cards',
  possessionPct:'Possession',totalShots:'Shots',shotsOnTarget:'On target',shotPct:'Shot accuracy',
  blockedShots:'Blocked shots',wonCorners:'Corners',penaltyKickGoals:'Penalty goals',penaltyKickShots:'Penalty kicks',
  totalPasses:'Passes',accuratePasses:'Accurate passes',passPct:'Pass completion',
  totalCrosses:'Crosses',accurateCrosses:'Accurate crosses',crossPct:'Cross completion',
  totalLongBalls:'Long balls',accurateLongBalls:'Accurate long balls',longballPct:'Long ball completion',
  totalTackles:'Tackles',effectiveTackles:'Effective tackles',tacklePct:'Tackle success',
  interceptions:'Interceptions',totalClearance:'Clearances',effectiveClearance:'Effective clearances',saves:'Saves',
  foulsCommitted:'Fouls',offsides:'Offsides',yellowCards:'Yellow cards',redCards:'Red cards',
};

const NEGATIVE = new Set(['foulsCommitted','yellowCards','redCards','offsides','duelsLost','aerialsLost','dispossessed','ppda','expectedGoalsOnTargetConceded']);

const numeric = (value?:string) => {
  if(!value) return null;
  const cleaned = value.trim().replace(/[,\s%]/g,'');
  if(!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number.parseFloat(cleaned);
};

const scale = (name:string, value:number) => name.endsWith('Pct') && value > 0 && value <= 1 ? value * 100 : value;

export const formatStatisticValue = (name:string, stat?:Stat) => {
  if(!stat) return '—';
  if(name.endsWith('Pct')) {
    const value = numeric(stat.value);
    if(value !== null) {
      const pct = stat.value.includes('%')?value:scale(name,value);
      return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(1))}%`;
    }
  }
  return stat.value;
};

export function MatchStats({match,statistics}:{match:Match;statistics:MatchSummary['statistics']}) {
  const [group,setGroup]=useState('All');
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

  const active=sections.some(section=>section.title===group)?group:'All';
  return <><div className="stats-toolbar"><span>Match totals · {byName.size} metrics</span><select aria-label="Statistic group" value={active} onChange={event=>setGroup(event.target.value)}><option value="All">All statistics</option>{sections.map(section=><option key={section.title}>{section.title}</option>)}</select></div><div className="stat-comparison" role="table" aria-label="Team statistics">
    <div className="sr-only" role="row"><strong role="columnheader">{match.home.name}</strong><span role="columnheader">Statistic</span><strong role="columnheader">{match.away.name}</strong></div>
    {sections.filter(section=>active==='All'||section.title===active).map(section=><div className="stat-section" role="rowgroup" key={section.title}>
      <div className="stat-section-title" role="row"><span role="columnheader" aria-colspan={3}>{section.title}</span></div>
      {section.rows.map(pair=>{
        const left=numeric(pair.home?.value),right=numeric(pair.away?.value);
        const leftValue=left===null?null:(pair.home?.value.includes('%')?left:scale(pair.name,left)),rightValue=right===null?null:(pair.away?.value.includes('%')?right:scale(pair.name,right));
        const comparable=leftValue!==null&&rightValue!==null&&leftValue>=0&&rightValue>=0;
        const peak=comparable?Math.max(leftValue,rightValue):0;
        const leftWidth=comparable&&peak>0?Math.round((leftValue/peak)*100):0;
        const rightWidth=comparable&&peak>0?Math.round((rightValue/peak)*100):0;
        const homeLeads=comparable&&!NEGATIVE.has(pair.name)&&leftValue>rightValue;
        const awayLeads=comparable&&!NEGATIVE.has(pair.name)&&rightValue>leftValue;
        return <div className="stat-row" role="row" key={pair.name}>
          <span role="cell" className={homeLeads?'stat-leading':undefined}>{formatStatisticValue(pair.name,pair.home)}</span>
          <span role="cell">{LABELS[pair.name]||pair.home?.label||pair.away?.label||pair.name}</span>
          <span role="cell" className={awayLeads?'stat-leading':undefined}>{formatStatisticValue(pair.name,pair.away)}</span>
          {comparable&&<div className="stat-bar" aria-hidden="true"><span className={'bar-home '+(homeLeads?'winning':'')}><i style={{width:`${leftWidth}%`}}/></span><span className={'bar-away '+(awayLeads?'winning':'')}><i style={{width:`${rightWidth}%`}}/></span></div>}
        </div>;
      })}
    </div>)}
  </div></>;
}

import { useState } from 'react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';
import { teamCode } from '../teams';

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

// The curated default view; the full list is one toggle away.
export const KEY_STATS = ['expectedGoals','possessionPct','totalShots','shotsOnTarget','bigChanceCreated','wonCorners','totalPasses','passPct','foulsCommitted','yellowCards','redCards','offsides'];

const NEGATIVE = new Set(['foulsCommitted','yellowCards','redCards','offsides','duelsLost','aerialsLost','dispossessed','ppda','expectedGoalsOnTargetConceded']);

const numeric = (value?:string) => {
  if(!value) return null;
  const cleaned = value.trim().replace(/[,\s%]/g,'');
  if(!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number.parseFloat(cleaned);
};

const scale = (name:string, value:number) => name !== 'possessionPct' && name.endsWith('Pct') && value > 0 && value <= 1 ? value * 100 : value;

/** Home share (0–1) of a two-sided bar; an empty 0–0 stat splits evenly. */
export const statSplit = (home:number, away:number) => home+away>0 ? Math.round(home/(home+away)*10000)/10000 : 0.5;

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
  const [expanded,setExpanded]=useState(false);
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

  const total=byName.size;
  const keyRows=KEY_STATS.map(key=>byName.get(key)).filter((pair):pair is Pair=>Boolean(pair));
  const active=sections.some(section=>section.title===group)?group:'All';
  // Only trim the default view when there is something to hide; a short list shows whole.
  const curated=active==='All'&&!expanded&&keyRows.length>0&&keyRows.length<total;
  const visibleSections=curated?[{title:'Key statistics',rows:keyRows}]:sections.filter(section=>active==='All'||section.title===active);
  const visibleCount=visibleSections.reduce((count,section)=>count+section.rows.length,0);
  const metrics=(count:number)=>`${count} ${count===1?'metric':'metrics'}`;
  const summary=curated?`Key statistics · ${visibleCount} of ${total}`:`${active==='All'?'All statistics':active} · ${metrics(visibleCount)}`;
  return <><div className="stats-toolbar"><span>{summary}</span><select aria-label="Statistic group" value={active} onChange={event=>setGroup(event.target.value)}><option value="All">All categories</option>{sections.map(section=><option key={section.title}>{section.title}</option>)}</select></div><div className="stat-comparison" role="table" aria-label="Team statistics">
    <div className="stat-teams" role="row"><strong role="columnheader" aria-label={match.home.name} title={match.home.name}>{teamCode(match.home)||match.home.name}</strong><span role="columnheader">Statistic</span><strong role="columnheader" aria-label={match.away.name} title={match.away.name}>{teamCode(match.away)||match.away.name}</strong></div>
    {visibleSections.map(section=><div className="stat-section" role="rowgroup" key={section.title}>
      <div className="stat-section-title" role="row"><span role="columnheader" aria-colspan={3}>{section.title}</span></div>
      {section.rows.map(pair=>{
        const left=numeric(pair.home?.value),right=numeric(pair.away?.value);
        const leftValue=left===null?null:(pair.home?.value.includes('%')?left:scale(pair.name,left)),rightValue=right===null?null:(pair.away?.value.includes('%')?right:scale(pair.name,right));
        const comparable=leftValue!==null&&rightValue!==null&&leftValue>=0&&rightValue>=0;
        const share=comparable?statSplit(leftValue,rightValue):0.5;
        const homeLeads=comparable&&!NEGATIVE.has(pair.name)&&leftValue>rightValue;
        const awayLeads=comparable&&!NEGATIVE.has(pair.name)&&rightValue>leftValue;
        return <div className="stat-row" role="row" key={pair.name}>
          <span role="cell" className={homeLeads?'stat-leading':undefined}>{formatStatisticValue(pair.name,pair.home)}</span>
          <span role="cell">{LABELS[pair.name]||pair.home?.label||pair.away?.label||pair.name}</span>
          <span role="cell" className={awayLeads?'stat-leading':undefined}>{formatStatisticValue(pair.name,pair.away)}</span>
          {comparable&&<div className="stat-bar" aria-hidden="true" data-home-share={share.toFixed(3)}>{share>0&&<i className={'bar-home'+(homeLeads?' winning':'')} style={{flexGrow:share}}/>}{share<1&&<i className={'bar-away'+(awayLeads?' winning':'')} style={{flexGrow:Math.round((1-share)*10000)/10000}}/>}</div>}
        </div>;
      })}
    </div>)}
  </div>{active==='All'&&keyRows.length>0&&keyRows.length<total&&<button type="button" className="text-button stats-expand" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show key statistics':`Show all ${total} statistics`}</button>}</>;
}

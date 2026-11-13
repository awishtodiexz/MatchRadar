import type { Match, Team } from '../types';
import type { MatchSummary } from '../useMatchSummary';
import { Badge } from './WidgetUi';
import { OverviewCard } from './MatchOverview';

type Leader = NonNullable<MatchSummary['leaders']>[number];
type FormGame = NonNullable<MatchSummary['form']>[string][number];
type Predictor = NonNullable<MatchSummary['predictor']>;

const formScore = (score:string, atHome:boolean) => {
  const parts=score.split('-').map(Number);
  if(parts.length!==2||parts.some(n=>!Number.isFinite(n))) return score;
  return atHome?`${parts[0]}–${parts[1]}`:`${parts[1]}–${parts[0]}`;
};

/** Plain figures only: "1,024" and " 38 " parse; anything else (n/a, 12%, empty) is NaN and not comparable. */
const numeric = (value:unknown):number => {
  const text=String(value??'').replace(/[,\s]/g,'');
  return /^\d+(\.\d+)?$/.test(text)?Number(text):NaN;
};

/**
 * ESPN leader values arrive as "Matches: 10, Goals: 9" or a bare "38". Pull out
 * the figure for the category and keep appearances as supporting context.
 */
export function leaderStat(category:string, value:string):{main:string;apps?:string} {
  const pairs=value.split(',').map(part=>part.split(':').map(piece=>piece.trim()));
  if(!pairs.every(pair=>pair.length===2&&pair[0]&&pair[1])) return {main:value};
  const wanted=category.toLowerCase();
  const own=pairs.find(([key])=>{const k=key.toLowerCase();return k===wanted||k.startsWith(wanted)||wanted.startsWith(k);});
  const apps=pairs.find(([key])=>/^(matches|appearances|apps|games)$/i.test(key));
  const main=own??pairs.find(pair=>pair!==apps)??pairs[0];
  return {main:main[1],apps:apps&&apps!==main?apps[1]:undefined};
}

const appsOf = (leader:Leader) => {
  const count=numeric(leader.apps??leaderStat(leader.category,leader.value).apps);
  return Number.isFinite(count)?String(count):undefined;
};

/** A leader's appearances: its own figure, else the same player's figure elsewhere on the team (by athleteId, or by name when there is no id). */
function resolveApps(leader:Leader, leaders:Leader[]):string|undefined {
  const own=appsOf(leader);
  if(own) return own;
  const id=leader.athleteId?.trim();
  return leaders
    .filter(other=>other!==leader&&other.teamId===leader.teamId&&(id?other.athleteId?.trim()===id:other.name===leader.name))
    .map(appsOf)
    .find(Boolean);
}

const share = (value:unknown) => typeof value==='number'&&Number.isFinite(value)&&value>=0?value:NaN;

/** Whole-percent shares that always sum to 100; rounding drift goes to the largest segment. */
function predictorShares(predictor:Predictor|null|undefined):[number,number,number]|null {
  const raw=[share(predictor?.home),share(predictor?.draw),share(predictor?.away)];
  const total=raw.reduce((sum,value)=>sum+value,0);
  if(!predictor||!(total>0)||!raw.every(value=>Number.isFinite(value))) return null;
  const exact=raw.map(value=>value/total*100);
  const rounded=exact.map(Math.round);
  const largest=exact.indexOf(Math.max(...exact));
  rounded[largest]+=100-rounded.reduce((sum,value)=>sum+value,0);
  return [rounded[0],rounded[1],rounded[2]];
}

const dayLabel = (value?:string|null) => {
  const date=value?new Date(value):null;
  return date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(date):undefined;
};

const tally = (games:FormGame[]) => {
  const count=(result:string)=>games.filter(game=>game.result===result).length;
  return {w:count('W'),d:count('D'),l:count('L')};
};

function FormPill({game,latest}:{game:FormGame;latest:boolean}) {
  const opponent=(game.opponent??'').trim()||'Unknown opponent';
  const score=game.score?formScore(game.score,game.atHome):'';
  const day=dayLabel(game.date);
  const outcome=game.result==='W'?'Win':game.result==='L'?'Loss':'Draw';
  const summary=[`${game.atHome?'vs':'@'} ${opponent}`,score,day].filter(Boolean).join(' · ');
  return <span tabIndex={0} role="img" className={'form-pill '+game.result.toLowerCase()+(latest?' is-latest':'')}
    aria-label={[`${outcome} ${game.atHome?'against':'at'} ${opponent}`,score,day].filter(Boolean).join(', ')}>{game.result}
    <span className="form-tip" role="tooltip">{summary}<em>{game.atHome?'Home':'Away'}</em></span>
  </span>;
}

function FormRow({team,games}:{team:Team;games:FormGame[]}) {
  const latest=games[games.length-1];
  const {w,d,l}=tally(games);
  return <div className="form-row">
    <Badge team={team}/>
    <div className="form-name"><strong title={team.name}>{team.short}</strong>
      {latest&&<small>Last: {latest.atHome?'vs':'@'} {latest.opponent} {latest.score&&formScore(latest.score,latest.atHome)}</small>}
    </div>
    <div className="form-side">
      <div className="form-pills">{games.map((game,index)=><FormPill key={`${game.opponentId}-${index}`} game={game} latest={index===games.length-1}/>)}</div>
      <small className="form-record" aria-label={`${w} wins, ${d} draws, ${l} losses`}>{w}W {d}D {l}L</small>
    </div>
  </div>;
}

function LeaderSide({leader,side,leading,figure,apps}:{leader?:Leader;side:'home'|'away';leading:boolean;figure:string;apps?:string}) {
  if(!leader) return <><div className={'leader-player '+side}><span className="leader-missing">—</span><small aria-hidden="true">{' '}</small></div><b className={'leader-value '+side}/></>;
  const jersey=leader.jersey?.trim();
  const meta=[jersey&&`#${jersey}`,apps&&`${apps} ${apps==='1'?'app':'apps'}`].filter(Boolean).join(' · ');
  const name=(leader.name??'').trim()||'Unknown player';
  return <>
    <div className={'leader-player '+side}><strong title={name}>{name}</strong>{meta?<small>{meta}</small>:<small aria-hidden="true">{' '}</small>}</div>
    <b className={'leader-value '+side+(leading?' is-leading':'')}>{figure||'—'}</b>
  </>;
}

export function MatchPreview({match,data}:{match:Match;data:MatchSummary|null}) {
  const teams=[match.home,match.away];
  const formTeams=teams.filter(team=>(data?.form?.[team.id]?.length??0)>0);
  const leaders=data?.leaders??[];
  const categories=[...new Set(leaders.filter(leader=>teams.some(team=>team.id===leader.teamId)).map(leader=>leader.category))].slice(0,4);
  const rows=categories.map(category=>({category,
    home:leaders.find(leader=>leader.teamId===match.home.id&&leader.category===category),
    away:leaders.find(leader=>leader.teamId===match.away.id&&leader.category===category)}));
  // Appearances are shown on every row or on none, so the figures stay comparable.
  const shown=rows.flatMap(row=>[row.home,row.away]).filter((leader):leader is Leader=>!!leader);
  const appsFor=new Map(shown.map(leader=>[leader,resolveApps(leader,leaders)]));
  const withApps=shown.length>0&&shown.every(leader=>appsFor.get(leader));
  // Only ESPN's own projection is shown. Rust can also derive shares from bookmaker
  // odds (source 'odds'), but a betting price is not a forecast and is not displayed.
  const shares=data?.predictor?.source==='espn'?predictorShares(data.predictor):null;
  return <>
    {shares&&match.status==='scheduled'&&data?.predictor&&<OverviewCard title="Matchup predictor" label="Matchup predictor"
      note="ESPN projection">
      <div className="predictor-labels">
        <span className="predictor-home"><Badge team={match.home}/><b>{match.home.short}</b><strong>{shares[0]}%</strong></span>
        <span className="predictor-draw">Draw <strong>{shares[1]}%</strong></span>
        <span className="predictor-away"><strong>{shares[2]}%</strong><b>{match.away.short}</b><Badge team={match.away}/></span>
      </div>
      <div className="predictor-bar" role="img" aria-label={`${match.home.name} ${shares[0]}%, draw ${shares[1]}%, ${match.away.name} ${shares[2]}%`}>
        <i className="home" style={{flexGrow:shares[0],minWidth:shares[0]?2:0}}/><i className="draw" style={{flexGrow:shares[1],minWidth:shares[1]?2:0}}/><i className="away" style={{flexGrow:shares[2],minWidth:shares[2]?2:0}}/>
      </div>
    </OverviewCard>}
    {!!formTeams.length&&<OverviewCard title="Form" note="Last five · latest right" label="Form">
      <div className="form-list">{formTeams.map(team=><FormRow key={team.id} team={team} games={data?.form?.[team.id]??[]}/>)}</div>
    </OverviewCard>}
    {!!categories.length&&<OverviewCard title="Team leaders" note="This season" label="Team leaders">
      <div className="leader-teams" aria-hidden="true">
        <span><Badge team={match.home}/>{match.home.short}</span><span>{match.away.short}<Badge team={match.away}/></span>
      </div>
      <ul className="leader-rows">{rows.map(({category,home,away})=>{
        const homeValue=home?numeric(leaderStat(category,home.value).main):NaN;
        const awayValue=away?numeric(leaderStat(category,away.value).main):NaN;
        const comparable=Number.isFinite(homeValue)&&Number.isFinite(awayValue);
        const homeLeads=comparable&&homeValue>awayValue;
        const awayLeads=comparable&&awayValue>homeValue;
        const bar=comparable&&homeValue+awayValue>0;
        return <li key={category} className="leader-row">
          <LeaderSide leader={home} side="home" leading={homeLeads} figure={home?leaderStat(category,home.value).main:''} apps={withApps&&home?appsFor.get(home):undefined}/>
          <span className="leader-category">{category}</span>
          <LeaderSide leader={away} side="away" leading={awayLeads} figure={away?leaderStat(category,away.value).main:''} apps={withApps&&away?appsFor.get(away):undefined}/>
          {bar&&<div className="leader-bar" aria-hidden="true"><i className={'home'+(homeLeads?' lead':'')} style={{flexGrow:homeValue}}/><i className={'away'+(awayLeads?' lead':'')} style={{flexGrow:awayValue}}/></div>}
        </li>;
      })}</ul>
    </OverviewCard>}
  </>;
}

import type { Match, Team } from '../types';
import type { MatchSummary } from '../useMatchSummary';
import { Badge } from './WidgetUi';
import { OverviewCard } from './MatchOverview';

type Leader = NonNullable<MatchSummary['leaders']>[number];
type FormGame = NonNullable<MatchSummary['form']>[string][number];

const formScore = (score:string, atHome:boolean) => {
  const parts=score.split('-').map(Number);
  if(parts.length!==2||parts.some(n=>!Number.isFinite(n))) return score;
  return atHome?`${parts[0]}–${parts[1]}`:`${parts[1]}–${parts[0]}`;
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

const tally = (games:FormGame[]) => {
  const count=(result:string)=>games.filter(game=>game.result===result).length;
  return {w:count('W'),d:count('D'),l:count('L')};
};

function FormRow({team,games}:{team:Team;games:FormGame[]}) {
  const latest=games[games.length-1];
  const {w,d,l}=tally(games);
  return <div className="form-row">
    <Badge team={team}/>
    <div className="form-name"><strong title={team.name}>{team.short}</strong>
      {latest&&<small>Last: {latest.atHome?'vs':'@'} {latest.opponent} {formScore(latest.score,latest.atHome)}</small>}
    </div>
    <div className="form-side">
      <div className="form-pills">{games.map((game,index)=><span key={`${game.opponentId}-${index}`} role="img"
        className={'form-pill '+game.result.toLowerCase()+(index===games.length-1?' is-latest':'')}
        title={`${game.atHome?'vs':'@'} ${game.opponent} · ${formScore(game.score,game.atHome)}`}
        aria-label={`${game.result==='W'?'Win':game.result==='L'?'Loss':'Draw'} ${game.atHome?'against':'at'} ${game.opponent}, ${formScore(game.score,game.atHome)}`}>{game.result}</span>)}</div>
      <small className="form-record" aria-label={`${w} wins, ${d} draws, ${l} losses`}>{w}W {d}D {l}L</small>
    </div>
  </div>;
}

function LeaderSide({leader,side,leading}:{leader?:Leader;side:'home'|'away';leading:boolean}) {
  if(!leader) return <><div className={'leader-player '+side}><span className="leader-missing">—</span></div><b className={'leader-value '+side}/></>;
  const {main,apps}=leaderStat(leader.category,leader.value);
  const meta=[leader.jersey&&`#${leader.jersey}`,apps&&`${apps} apps`].filter(Boolean).join(' · ');
  return <>
    <div className={'leader-player '+side}><strong title={leader.name}>{leader.name}</strong>{meta&&<small>{meta}</small>}</div>
    <b className={'leader-value '+side+(leading?' is-leading':'')}>{main}</b>
  </>;
}

export function MatchPreview({match,data}:{match:Match;data:MatchSummary|null}) {
  const teams=[match.home,match.away];
  const formTeams=teams.filter(team=>(data?.form?.[team.id]?.length??0)>0);
  const leaders=data?.leaders??[];
  const categories=[...new Set(leaders.filter(leader=>teams.some(team=>team.id===leader.teamId)).map(leader=>leader.category))].slice(0,4);
  return <>
    {!!formTeams.length&&<OverviewCard title="Form" note="Last five · latest right" label="Form">
      <div className="form-list">{formTeams.map(team=><FormRow key={team.id} team={team} games={data?.form?.[team.id]??[]}/>)}</div>
    </OverviewCard>}
    {!!categories.length&&<OverviewCard title="Team leaders" note="This season" label="Team leaders">
      <div className="leader-teams" aria-hidden="true">
        <span><Badge team={match.home}/>{match.home.short}</span><span>{match.away.short}<Badge team={match.away}/></span>
      </div>
      <ul className="leader-rows">{categories.map(category=>{
        const home=leaders.find(leader=>leader.teamId===match.home.id&&leader.category===category);
        const away=leaders.find(leader=>leader.teamId===match.away.id&&leader.category===category);
        const homeValue=Number(home&&leaderStat(category,home.value).main);
        const awayValue=Number(away&&leaderStat(category,away.value).main);
        const comparable=Number.isFinite(homeValue)&&Number.isFinite(awayValue)&&!!home&&!!away;
        return <li key={category} className="leader-row">
          <LeaderSide leader={home} side="home" leading={comparable&&homeValue>awayValue}/>
          <span className="leader-category">{category}</span>
          <LeaderSide leader={away} side="away" leading={comparable&&awayValue>homeValue}/>
        </li>;
      })}</ul>
    </OverviewCard>}
  </>;
}

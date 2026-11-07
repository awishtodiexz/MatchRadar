import { useId, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

const groups = ['Goalkeepers','Defenders','Midfielders','Forwards','Other positions'] as const;
type Group = typeof groups[number];

export function positionGroup(position:string):Group {
  const code = position.trim().toUpperCase().replace(/\s+/g,'');
  if(['G','GK','GOALKEEPER'].includes(code)) return 'Goalkeepers';
  if(/^(D|DF|DEF|CB|CD|LB|RB|LWB|RWB|SW)/.test(code)) return 'Defenders';
  if(/^(M|MF|MID|CM|DM|AM|LM|RM|CDM|CAM)/.test(code)) return 'Midfielders';
  if(/^(F|FW|ST|CF|SS|LW|RW)/.test(code)) return 'Forwards';
  return 'Other positions';
}
const byPlace = (a:MatchSummary['players'][number], b:MatchSummary['players'][number]) =>
  (a.formationPlace ?? 99) - (b.formationPlace ?? 99) || a.name.localeCompare(b.name);
type PitchData = { lines:MatchSummary['players'][]; keeper:MatchSummary['players'][number]; formation:string };

function buildPitch(players:MatchSummary['players'],formation?:string):PitchData|null {
  const xi = players.filter(player=>player.starter).sort(byPlace);
  const shape = (formation ?? '').split('-').map(Number);
  if(xi.length !== 11 || xi.some(player=>!player.formationPlace) || !formation || shape.length < 2 || shape.some(n=>!Number.isInteger(n)||n<1) || shape.reduce((sum,n)=>sum+n,0) !== 10) return null;
  const keeper = xi.find(player=>positionGroup(player.position)==='Goalkeepers');
  if(!keeper) return null;
  const outfield = xi.filter(player=>player!==keeper);
  let cursor = 0;
  const lines = shape.map(count=>{const line=outfield.slice(cursor,cursor+count);cursor+=count;return line;});
  return cursor===10 ? {lines,keeper,formation} : null;
}

function LineupPitch({match,home,away}:{match:Match;home:PitchData;away:PitchData}) {
  const renderColumn = (line:MatchSummary['players'],side:'home'|'away',keeper:MatchSummary['players'][number]) =>
    <div className="pitch-column" key={line.map(player=>player.name).join('-')+side}>
      {line.map(player=><span key={player.name+side} className={'pitch-shirt '+side+(player===keeper?' is-keeper':'')}
        title={`${side==='home'?match.home.name:match.away.name} · #${player.jersey||'–'} ${player.name}`}>
        {player.jersey||'–'}
      </span>)}
    </div>;
  const homeColumns:MatchSummary['players'][] = [[home.keeper],...home.lines];
  const awayColumns:MatchSummary['players'][] = [...away.lines].reverse().concat([[away.keeper]]);
  return <>
    <div className="formation-strip" aria-label={`Formations: ${match.home.name} ${home.formation}, ${match.away.name} ${away.formation}`}>
      <strong>{home.formation}</strong><span>FORMATION</span><strong>{away.formation}</strong>
    </div>
    <div className="lineup-pitch split" aria-hidden="true">
      <span className="pitch-halfway"/><span className="pitch-circle"/>
      <span className="pitch-box pitch-box-left"/><span className="pitch-box pitch-box-right"/>
      <div className="pitch-side home">{homeColumns.map(line=>renderColumn(line,'home',home.keeper))}</div>
      <div className="pitch-side away">{awayColumns.map(line=>renderColumn(line,'away',away.keeper))}</div>
    </div>
  </>;
}

function PlayerList({players, substitutions}: {players:MatchSummary['players']; substitutions:NonNullable<MatchSummary['substitutions']>}) {
  return <>{groups.map(group=>{
    const list = players.filter(player=>positionGroup(player.position)===group).sort(byPlace);
    return list.length ? <div className="lineup-group" key={group}>
      <h5>{group}</h5>
      <ul className="lineup-list">{list.map((player,index)=>{
        const on = substitutions.find(sub=>sub.playerIn===player.name);
        const off = substitutions.find(sub=>sub.playerOut===player.name);
        return <li key={`${player.name}-${index}`}>
          {player.jersey && <span className="jersey">#{player.jersey}</span>}
          <span>{player.name}</span>
          <small>{player.position}{off&&<span className="sub-marker off" title={`Substituted off at ${off.minute}`}> ↓ {off.minute}</span>}{on&&<span className="sub-marker on" title={`Substituted on at ${on.minute}`}> ↑ {on.minute}</span>}{!on&&!off&&player.subbedOut?' · off':!on&&!off&&player.subbedIn?' · on':''}</small>
        </li>;
      })}</ul>
    </div> : null;
  })}</>;
}

export function MatchLineups({match,players,substitutions=[],formations={}}: {match:Match;players:MatchSummary['players'];substitutions?:MatchSummary['substitutions'];formations?:Record<string,string>}) {
  const sectionId = useId();
  const teams = [match.home, match.away];
  const [teamId,setTeamId] = useState<string|null>(null);
  const totals = Object.fromEntries(teams.map(team=>[team.id,players.filter(player=>player.teamId===team.id).length]));
  const activeId = teamId ?? (totals[match.home.id] ? match.home.id : totals[match.away.id] ? match.away.id : match.home.id);
  const active = teams.find(team=>team.id===activeId) ?? match.home;
  const selected = players.filter(player=>player.teamId===active.id);
  const starters = selected.filter(player=>player.starter);
  const substitutes = selected.filter(player=>!player.starter);
  const formation = formations[active.id];
  const homePitch = buildPitch(players.filter(player=>player.teamId===match.home.id),formations[match.home.id]);
  const awayPitch = buildPitch(players.filter(player=>player.teamId===match.away.id),formations[match.away.id]);
  const teamSubs = substitutions.filter(sub=>!sub.teamId||sub.teamId===active.id);
  return <div className="lineups">
    {homePitch&&awayPitch&&<LineupPitch match={match} home={homePitch} away={awayPitch}/>}
    <div className="lineup-tabs" role="tablist" aria-label="Lineups by team">
      {teams.map(team=><button key={team.id} role="tab" id={sectionId+'-tab-'+team.id} aria-selected={active.id===team.id}
        aria-controls={sectionId+'-panel'} tabIndex={active.id===team.id?0:-1} className="lineup-tab"
        title={team.name} onClick={()=>setTeamId(team.id)}
        onKeyDown={event=>{
          if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
          event.preventDefault();
          const next = teams[(teams.findIndex(team=>team.id===active.id)+(event.key==='ArrowRight'?1:teams.length-1))%teams.length];
          setTeamId(next.id);
          document.getElementById(sectionId+'-tab-'+next.id)?.focus();
        }}>
        <span>{team.name}</span><small>{totals[team.id]||'—'}</small>
      </button>)}
    </div>
    <div role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-tab-'+active.id} tabIndex={0}>
      <div className="lineup-heading"><h3>{active.name}</h3>{formation&&<span className="formation">{formation}</span>}</div>
      {!selected.length&&<p className="field-note">Lineup unavailable</p>}
      {starters.length>0&&<><h4>Starting XI <small className="kickoff-note">at kickoff</small></h4><PlayerList players={starters} substitutions={substitutions}/></>}
      {starters.length===0&&selected.length>0&&<><h4>Squad</h4><PlayerList players={selected} substitutions={substitutions}/></>}
      {substitutes.length>0&&<><h4>Substitutes</h4><ul className="lineup-list">{substitutes.sort(byPlace).map((player,index)=>{
        const on=substitutions.find(sub=>sub.playerIn===player.name);
        return <li key={`${player.name}-${index}`}>
          {player.jersey&&<span className="jersey">#{player.jersey}</span>}<span>{player.name}</span><small>{player.position}{on&&<span className="sub-marker on" title={`Substituted on at ${on.minute}`}> ↑ {on.minute}</span>}{!on&&player.subbedIn?' · on':''}</small>
        </li>;
      })}</ul></>}
      {!!teamSubs.length&&<><h4>Substitutions</h4><ul className="subs-list">{teamSubs.map(sub=><li key={`${sub.minute}-${sub.playerIn}-${sub.playerOut}`}>
        <time>{sub.minute}</time>
        <div><span className="sub-in"><ArrowUp size={11} aria-hidden="true"/>{sub.playerIn}</span><span className="sub-out"><ArrowDown size={11} aria-hidden="true"/>for {sub.playerOut}</span></div>
      </li>)}</ul></>}
    </div>
  </div>;
}

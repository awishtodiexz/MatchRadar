import { useId, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

const groups = ['Goalkeepers','Defenders','Midfielders','Forwards','Other positions'] as const;
type Group = typeof groups[number];

export function positionGroup(position:string):Group {
  const code = position.trim().toUpperCase().replace(/\s+/g,'').split('-')[0];
  if(['G','GK','GOALKEEPER'].includes(code)) return 'Goalkeepers';
  if(/^(D|DF|DEF|CB|CD|LB|RB|LWB|RWB|SW)$/.test(code)) return 'Defenders';
  if(/^(M|MF|MID|CM|DM|AM|LM|RM|CDM|CAM|AML|AMR)$/.test(code)) return 'Midfielders';
  if(/^(F|FW|ST|CF|SS|LW|RW)$/.test(code)) return 'Forwards';
  return 'Other positions';
}
const byPlace = (a:MatchSummary['players'][number], b:MatchSummary['players'][number]) =>
  (a.formationPlace ?? 99) - (b.formationPlace ?? 99) || a.name.localeCompare(b.name);
type PitchData = { lines:MatchSummary['players'][]; keeper:MatchSummary['players'][number]; formation:string };

function buildPitch(players:MatchSummary['players'],formation?:string):PitchData|null {
  const xi = players.filter(player=>player.starter).sort(byPlace);
  const shape = (formation ?? '').split('-').map(Number);
  if(xi.length !== 11 || xi.some(player=>!Number.isInteger(player.formationPlace)||!player.formationPlace||player.formationPlace<1||player.formationPlace>11) || new Set(xi.map(player=>player.formationPlace)).size!==11 || !formation || shape.length < 2 || shape.some(n=>!Number.isInteger(n)||n<1) || shape.reduce((sum,n)=>sum+n,0) !== 10) return null;
  const keeper = xi.find(player=>positionGroup(player.position)==='Goalkeepers');
  if(!keeper) return null;
  // ESPN's formationPlace is a slot identifier, not back-to-front order.
  // Use the supplied position to group lines before applying the formation.
  const band = (position:string) => {
    const code = position.toUpperCase();
    if(positionGroup(code)==='Defenders') return 1;
    if(/^(DM|CDM)/.test(code)) return 2;
    if(/^(AM|CAM|LW|RW)/.test(code)) return 4;
    return positionGroup(code)==='Forwards'?5:3;
  };
  const lateral = (position:string) => /-L$|^(LB|LWB|LM|LW|AML)$/.test(position)?0:/-R$|^(RB|RWB|RM|RW|AMR)$/.test(position)?2:1;
  const outfield = xi.filter(player=>player!==keeper).sort((a,b)=>band(a.position)-band(b.position)||byPlace(a,b));
  let cursor = 0;
  const lines = shape.map(count=>{const line=outfield.slice(cursor,cursor+count);cursor+=count;return line.sort((a,b)=>lateral(a.position)-lateral(b.position)||byPlace(a,b));});
  return cursor===10 ? {lines,keeper,formation} : null;
}

function LineupPitch({team,pitch}:{team:Match['home'];pitch:PitchData}) {
  const lines = [...pitch.lines].reverse().concat([[pitch.keeper]]);
  return <div className="lineup-pitch" aria-hidden="true">
    <span className="pitch-halfway"/><span className="pitch-circle"/>
    <span className="pitch-box pitch-box-top"/><span className="pitch-box pitch-box-bottom"/>
    {lines.map((line,index)=><div className="pitch-row" key={index}>{line.map(player=><span className="pitch-player" key={player.formationPlace} title={`${team.name} · #${player.jersey||'–'} ${player.name}`}>
      <span className={'pitch-shirt '+(player===pitch.keeper?'is-keeper':'')}>{player.jersey||'–'}</span>
      <span className="pitch-name">{player.name.split(' ').slice(-1).join(' ')}</span>
    </span>)}</div>)}
  </div>;
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

export function MatchLineups({match,players,substitutions=[],formations={},coaches=[]}: {match:Match;players:MatchSummary['players'];substitutions?:MatchSummary['substitutions'];formations?:Record<string,string>;coaches?:MatchSummary['coaches']}) {
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
  const pitch = buildPitch(selected,formation);
  const playerTeam = (name:string) => players.find(player=>player.name===name)?.teamId;
  // ESPN sometimes omits the team on a substitution; infer it from the players
  // instead of showing the same substitution under both teams.
  const teamSubs = substitutions.filter(sub => (sub.teamId || playerTeam(sub.playerIn) || playerTeam(sub.playerOut)) === active.id);
  return <div className="lineups">
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
      <div className="coach-row"><span>Coach</span><strong>{coaches.filter(coach=>coach.teamId===active.id).map(coach=>coach.name).join(', ')||'Not provided by ESPN'}</strong></div>
      {pitch&&<LineupPitch team={active} pitch={pitch}/>}
      {!selected.length&&<p className="field-note">Lineup unavailable</p>}
      {starters.length>0&&<><h4>Starting XI <small className="kickoff-note">at kickoff</small></h4><PlayerList players={starters} substitutions={teamSubs}/></>}
      {starters.length===0&&selected.length>0&&<><h4>Squad</h4><PlayerList players={selected} substitutions={teamSubs}/></>}
      {substitutes.length>0&&<><h4>Substitutes</h4><ul className="lineup-list">{substitutes.sort(byPlace).map((player,index)=>{
        const on=teamSubs.find(sub=>sub.playerIn===player.name);
        const off=teamSubs.find(sub=>sub.playerOut===player.name);
        return <li key={`${player.name}-${index}`}>
          {player.jersey&&<span className="jersey">#{player.jersey}</span>}<span>{player.name}</span><small>{player.position}{on&&<span className="sub-marker on" title={`Substituted on at ${on.minute}`}> ↑ {on.minute}</span>}{!on&&player.subbedIn?' · on':''}{off&&<span className="sub-marker off" title={`Substituted off at ${off.minute}`}> ↓ {off.minute}</span>}{!off&&player.subbedOut?' · off':''}</small>
        </li>;
      })}</ul></>}
      {!!teamSubs.length&&<><h4>Substitutions</h4><ul className="subs-list">{teamSubs.map(sub=><li key={`${sub.minute}-${sub.playerIn}-${sub.playerOut}`}>
        <time>{sub.minute}</time>
        <div><span className="sub-in"><ArrowUp size={11} aria-hidden="true"/>{sub.playerIn}</span><span className="sub-out"><ArrowDown size={11} aria-hidden="true"/>for {sub.playerOut}</span></div>
      </li>)}</ul></>}
    </div>
  </div>;
}

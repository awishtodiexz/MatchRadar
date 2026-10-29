import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

const groups=['Goalkeepers','Defenders','Midfielders','Forwards','Other positions'] as const;
function positionGroup(position:string):typeof groups[number] {
  const code=position.trim().toUpperCase();
  if(['G','GK','GOALKEEPER'].includes(code))return 'Goalkeepers';
  if(['D','DF','DEF','CB','LB','RB','LWB','RWB'].includes(code))return 'Defenders';
  if(['M','MF','MID','CM','DM','AM','LM','RM'].includes(code))return 'Midfielders';
  if(['F','FW','ST','CF','LW','RW'].includes(code))return 'Forwards';
  return 'Other positions';
}
export function MatchLineups({match,players}:{match:Match;players:MatchSummary['players']}) {
  return <div className="lineups">{[match.home,match.away].map(team=>{
    const selected=players.filter(p=>p.teamId===team.id);
    return <section key={team.id}><h3>{team.name}</h3>
      {!selected.length&&<p className="field-note">Lineup unavailable</p>}
      {selected.some(p=>p.starter)&&<h4>Starting XI</h4>}
      {groups.map(group=>{const list=selected.filter(p=>p.starter&&positionGroup(p.position)===group);return list.length?<div key={group}><h5>{group}</h5><ul className="lineup-list">{list.map((p,i)=><li key={`${p.name}-${i}`}><span>{p.name}</span><small>{p.position}</small></li>)}</ul></div>:null;})}
      {selected.some(p=>!p.starter)&&<><h4>Substitutes and other players</h4><ul className="lineup-list">{selected.filter(p=>!p.starter).map((p,i)=><li key={`${p.name}-${i}`}><span>{p.name}</span><small>{p.position}</small></li>)}</ul></>}
    </section>;
  })}</div>;
}

import { useState } from 'react';
import type { Match } from '../types';
import { isLive } from '../fixtures';
import { useMatchSummary } from '../useMatchSummary';
export function MatchCentre({match,demo}:{match:Match;demo:boolean}) {
  const {data,loading,error,retry}=useMatchSummary(match.id,isLive(match),demo);
  const [selected,setSelected]=useState('Overview');
  const tabs=['Overview',...(data?.events.length?['Timeline']:[]),...(data?.statistics.length?['Stats']:[]),...(data?.players.length?['Lineups']:[])];
  const tab=tabs.includes(selected)?selected:'Overview';
  const team=(id:string|null)=>id===match.home.id?match.home.name:id===match.away.id?match.away.name:'Match';
  return <section className="match-centre" aria-label="Match centre">
    <div className="centre-tabs" aria-label="Match centre sections">{tabs.map(name=><button key={name} aria-pressed={tab===name} onClick={()=>setSelected(name)}>{name}</button>)}</div>
    {loading&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}
    {data&&<p className="field-note">{data.stale?'Saved details':'Details checked'} · {new Date(data.updatedAt).toLocaleTimeString()}</p>}
    {tab==='Overview'&&<><h3>Match events</h3><p>{demo?'Event details aren’t available from this feed yet.':data?.events.length?`${data.events.length} provider events available in Timeline.`:'No event timeline is available for this match.'}</p><p className="field-note">Scores come from the matchday scoreboard. Match details may update separately.</p></>}
    {tab==='Timeline'&&<ol className="event-list">{data?.events.map(e=><li key={e.id}><time>{e.minute||'—'}</time><div><small>{team(e.teamId)} · {e.kind.replaceAll('-',' ')}</small><p>{e.text}</p></div></li>)}</ol>}
    {tab==='Stats'&&<>{[match.home,match.away].map(t=><section key={t.id}><h3>{t.name}</h3><dl className="centre-stats">{data?.statistics.filter(s=>s.teamId===t.id).map(s=><div key={s.name}><dt>{s.label||s.name}</dt><dd>{s.value}</dd></div>)}</dl></section>)}</>}
    {tab==='Lineups'&&<>{[match.home,match.away].map(t=><section key={t.id}><h3>{t.name}</h3>{[true,false].map(starter=><div key={String(starter)}><h4>{starter?'Starting XI':'Other listed players'}</h4><ul className="lineup-list">{data?.players.filter(p=>p.teamId===t.id&&p.starter===starter).map(p=><li key={p.name}><span>{p.name}</span><small>{p.position}</small></li>)}</ul></div>)}</section>)}</>}
  </section>;
}

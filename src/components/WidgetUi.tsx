import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { crestCandidates } from '../teams';
import { useApp } from '../store';
import type { Competition, Team } from '../types';

export function Badge({team}: {team: Team}) {
  const theme = useApp(state => state.snapshot?.settings.theme ?? 'dark');
  const candidates = useMemo(() => crestCandidates(team, theme), [team.id, team.logo, theme]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [team.id, team.logo, theme]);
  const src = candidates[index];
  return <span className={'badge '+(src?'has-crest':'')} aria-hidden="true">
    {src ? <img src={src} onError={() => setIndex(i => i + 1)} alt="" /> : <span>{(team.short || team.name.slice(0,3)).slice(0,3).toUpperCase()}</span>}
  </span>;
}

export function LeagueMark() {
  return <span className="league-mark" role="img" aria-label="Premier League competition emblem"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7l4 3 3-5 4 4 4-4 3 5 4-3-2 8H7z" fill="currentColor"/><path d="M7 17h18v4c0 5-4 8-9 10-5-2-9-5-9-10z" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="16" cy="21" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M16 18v6m-3-4 6 2m0-2-6 2" stroke="currentColor" strokeWidth=".8"/></svg></span>;
}

export function ChampionsMark() {
  return <span className="league-mark champions-mark" role="img" aria-label="Champions League competition emblem"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 5.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L16 20.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" fill="currentColor"/></svg></span>;
}

export function CompetitionMark({league}: {league: Competition|'both'}) {
  if (league === 'both') return <span className="league-mark both-mark" role="img" aria-label="Premier League and Champions League"><span className="mark-pair" aria-hidden="true"><LeagueMark/><ChampionsMark/></span></span>;
  return league === 'championsLeague' ? <ChampionsMark/> : <LeagueMark/>;
}

export function Toggle({label, description, value, onChange, disabled=false}: {
  label:string; description?:string; value:boolean; onChange:(v:boolean)=>void; disabled?:boolean;
}) {
  const id = useId();
  return <label className={'setting-row '+(disabled?'is-disabled':'')}>
    <span><b>{label}</b>{description && <small id={id}>{description}</small>}</span>
    <input type="checkbox" aria-label={label} aria-describedby={description?id:undefined} checked={value} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>
    <span className="switch" aria-hidden="true"/>
  </label>;
}

export function ViewHeading({title, eyebrow, back, actions}: {title:string; eyebrow:string; back:()=>void; actions?:ReactNode}) {
  return <div className="subhead">
    <button className="icon-button" onClick={back} aria-label="Back to matches" title="Back to matches (Esc)"><ArrowLeft size={18}/></button>
    <div><span className="eyebrow">{eyebrow}</span><h2 data-view-heading tabIndex={-1}>{title}</h2></div>
    {actions&&<div className="subhead-actions">{actions}</div>}
  </div>;
}

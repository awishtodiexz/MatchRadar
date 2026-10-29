import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { crestCandidates } from '../teams';
import { useApp } from '../store';
import type { Team } from '../types';

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

export function ViewHeading({title, eyebrow, back}: {title:string; eyebrow:string; back:()=>void}) {
  return <div className="subhead">
    <button className="icon-button" onClick={back} aria-label="Back to matches" title="Back to matches (Esc)"><ArrowLeft size={18}/></button>
    <div><span className="eyebrow">{eyebrow}</span><h2 data-view-heading tabIndex={-1}>{title}</h2></div>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { CompetitionMark } from './WidgetUi';
import type { CompetitionView } from '../types';

const options: Array<{value: CompetitionView; label: string; short: string}> = [
  {value:'premierLeague', label:'Premier League', short:'England'},
  {value:'championsLeague', label:'Champions League', short:'Europe'},
  {value:'both', label:'Both competitions', short:'All fixtures'}
];

export function CompetitionPicker({value, onChange, disabled=false}: {
  value: CompetitionView;
  onChange: (value: CompetitionView) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement|null>>([]);
  const current = options.find(option => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const focus = (event: FocusEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', click);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('focusin', focus);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, options.findIndex(option => option.value === value));
    items.current[index]?.focus();
  }, [open, value]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (next: CompetitionView) => { setOpen(false); onChange(next); trigger.current?.focus(); };
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (next === undefined) return;
    event.preventDefault();
    items.current[next]?.focus();
  };

  return <div className="competition-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <button ref={trigger} type="button" className="competition-trigger" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-label={`Competition: ${current.label}. Change competition`}
      onClick={() => setOpen(next => !next)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
        }
      }}>
      <span aria-hidden="true"><CompetitionMark league={value}/></span>
      <span className="competition-copy"><b><span className="competition-long">{current.label}</span><span className="competition-short">{current.value==='both'?'Both':current.label}</span></b><small aria-hidden="true">{current.short} · Match centre</small></span>
      <ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div className="competition-menu" role="listbox" aria-label="Competition">
      {options.map((option, index) => <button key={option.value} ref={node => { items.current[index] = node; }}
        type="button" role="option" aria-selected={option.value === value} tabIndex={option.value === value ? 0 : -1}
        className="competition-option"
        onClick={() => choose(option.value)}
        onKeyDown={event => move(event, index)}>
        <span aria-hidden="true"><CompetitionMark league={option.value}/></span>
        <span><b>{option.label}</b><small>{option.short}</small></span>
      </button>)}
    </div>}
  </div>;
}

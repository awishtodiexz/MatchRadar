import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { Bell, Check, ChevronDown, CircleHelp, RefreshCw, Search } from 'lucide-react';
import { clubs } from '../teams';
import type { Match, Settings, Team } from '../types';
import { Badge, Toggle, ViewHeading } from './WidgetUi';

const sections = ['Teams','Appearance','Alerts','App'] as const;
type Section = typeof sections[number];

export function SettingsPanel({settings, save, back, matches, refresh, refreshing}: {
  settings:Settings; save:(s:Partial<Settings>)=>Promise<void>; back:()=>void; matches:Match[]; refresh:()=>void; refreshing:boolean;
}) {
  const [section,setSection] = useState<Section>('Teams');
  const [query,setQuery] = useState('');
  const [showOtherClubs,setShowOtherClubs] = useState(false);
  const [notice,setNotice] = useState('');
  const [autostart,setAutostart] = useState<boolean|null>(null);
  const [startupError,setStartupError] = useState(false);
  const [testing,setTesting] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const native = isTauri();
  useEffect(()=>{
    let disposed = false;
    if(native) void isEnabled().then(value=>{if(!disposed) setAutostart(value);}).catch(()=>{if(!disposed) setStartupError(true);});
    return ()=>{disposed=true;};
  },[native]);
  const availableClubs = useMemo(()=>{
    const teams = new Map(clubs.map(team=>[team.id,team]));
    matches.flatMap(m=>[m.home,m.away]).forEach(team=>teams.set(team.id,team));
    return [...teams.values()];
  },[matches]);
  const byId = useMemo(()=>new Map(availableClubs.map(team=>[team.id,team])),[availableClubs]);
  const favoriteIds = useMemo(()=>[...new Set(settings.favorites)],[settings.favorites]);
  const favoriteSet = useMemo(()=>new Set(favoriteIds),[favoriteIds]);
  const plIds = useMemo(()=>{
    const ids = new Set(clubs.map(team=>team.id));
    matches.filter(m=>m.league==='premierLeague').flatMap(m=>[m.home,m.away]).forEach(team=>ids.add(team.id));
    return ids;
  },[matches]);
  const followedClubs = favoriteIds.map(id=>byId.get(id)).filter((club): club is Team => !!club);
  const plClubs = useMemo(()=>{
    const seen = new Set<string>();
    const list: Team[] = [];
    for(const club of [...clubs,...availableClubs]){
      if(plIds.has(club.id)&&!favoriteSet.has(club.id)&&!seen.has(club.id)){seen.add(club.id);list.push(club);}
    }
    return list;
  },[availableClubs,favoriteSet,plIds]);
  const otherClubs = availableClubs
    .filter(club=>!plIds.has(club.id)&&!favoriteSet.has(club.id))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const needle = query.trim().toLocaleLowerCase();
  const matchesQuery = (club:Team)=>club.name.toLocaleLowerCase().includes(needle);
  const followedVisible = needle?followedClubs.filter(matchesQuery):followedClubs;
  const plVisible = needle?plClubs.filter(matchesQuery):plClubs;
  const otherVisible = needle?otherClubs.filter(matchesQuery):otherClubs;
  const anyVisible = !!followedVisible.length||!!plVisible.length||!!otherVisible.length;
  const update = (patch:Partial<Settings>) => {void save(patch);};
  const toggleFavorite = (id:string) => {
    const following = favoriteSet.has(id);
    const favorites = following?settings.favorites.filter(favorite=>favorite!==id):[...settings.favorites,id];
    if (following&&!plIds.has(id)) setShowOtherClubs(true);
    update({favorites});
    // The club moves between sections; keep keyboard focus on it.
    setTimeout(()=>document.getElementById('club-'+id)?.focus(),0);
  };
  const clubButton = (club:Team) => <button key={club.id} id={'club-'+club.id} className="club" title={club.name}
    aria-pressed={favoriteSet.has(club.id)} onClick={()=>toggleFavorite(club.id)}>
    <Badge team={club}/><span>{club.name}</span><span className={'check '+(favoriteSet.has(club.id)?'selected':'')} aria-hidden="true">{favoriteSet.has(club.id)&&<Check size={13}/>}</span>
  </button>;
  const activate = (next:Section) => {setSection(next);setNotice('');if(panel.current) panel.current.scrollTop=0;};
  const tabKey = (event:KeyboardEvent<HTMLButtonElement>, index:number) => {
    const next = event.key==='ArrowRight'?(index+1)%sections.length:event.key==='ArrowLeft'?(index+sections.length-1)%sections.length:event.key==='Home'?0:event.key==='End'?sections.length-1:undefined;
    if(next===undefined) return;
    event.preventDefault();activate(sections[next]);document.getElementById('settings-tab-'+sections[next])?.focus();
  };
  const test = async () => {
    setTesting(true);
    try {if(native) await invoke('test_notification');setNotice(native?'Test notification requested. Check Windows notification settings if it does not appear.':'Notifications are available in the desktop app.');}
    catch {setNotice('Could not request a test notification. Check your Windows notification settings.');}
    finally {setTesting(false);}
  };
  return <>
    <ViewHeading title="Settings" eyebrow="MAKE IT YOURS" back={back}/>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {sections.map((name,index)=><button key={name} role="tab" id={'settings-tab-'+name} aria-controls="settings-panel" aria-selected={section===name} tabIndex={section===name?0:-1} onKeyDown={e=>tabKey(e,index)} onClick={()=>activate(name)}>{name}</button>)}
    </div>
    <div ref={panel} className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={'settings-tab-'+section} tabIndex={0}>
      {section==='Teams'&&<>
        <div className="section-intro"><h3>Your clubs</h3><p>Follow a club once — it counts in the Premier League and Champions League. Clubs appear as their fixtures load.</p></div>
        <Toggle label="Following only" value={settings.followedOnly} onChange={followedOnly=>update({followedOnly})}/>
        <label className="search"><Search size={15} aria-hidden="true"/><input ref={search} type="search" aria-label="Search clubs" placeholder="Search clubs" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        {!!followedVisible.length&&<section className="team-group" aria-labelledby="team-group-followed">
          <h4 id="team-group-followed" className="team-group-title">Followed clubs <span>{followedVisible.length}</span></h4>
          <div className="club-list">{followedVisible.map(clubButton)}</div>
        </section>}
        {!!plVisible.length&&<section className="team-group" aria-labelledby="team-group-premier">
          <h4 id="team-group-premier" className="team-group-title">Premier League clubs <span>{plVisible.length}</span></h4>
          <div className="club-list">{plVisible.map(clubButton)}</div>
        </section>}
        {!!otherClubs.length&&(!needle||!!otherVisible.length)&&<section className="team-group" aria-labelledby="team-group-other">
          {needle
            ? <h4 id="team-group-other" className="team-group-title">Other clubs <span>{otherVisible.length}</span></h4>
            : <button id="team-group-other" className="team-group-title team-group-toggle" aria-expanded={showOtherClubs} aria-controls="other-clubs-list" onClick={()=>setShowOtherClubs(open=>!open)}>Other clubs <span>{otherClubs.length}</span><ChevronDown size={14} aria-hidden="true" className={showOtherClubs?'rotated':''}/></button>}
          {(needle||showOtherClubs)&&<div id="other-clubs-list" className="club-list">{otherVisible.map(clubButton)}</div>}
        </section>}
        {!anyVisible&&needle&&<div className="search-empty" role="status"><p>No clubs match “{query}”.</p><button className="text-button" onClick={()=>{search.current?.focus();setQuery('');}}>Clear search</button></div>}
      </>}
      {section==='Appearance'&&<>
        <div className="section-intro"><h3>Set the mood</h3><p>The same matchday, in your style.</p></div>
        <label className="select-row">Theme<select aria-label="Theme" value={settings.theme} onChange={e=>update({theme:e.target.value==='light'?'light':'dark'})}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <Toggle label="Compact view" description="Start smaller and remember your expanded size. You can still resize the window." value={settings.compact} onChange={compact=>update({compact})}/>
        {!native&&<p className="field-note">Browser preview changes spacing only. The desktop app also resizes the window.</p>}
        <Toggle label="Always on top" description="Keep the widget above other windows" value={settings.alwaysOnTop} onChange={alwaysOnTop=>update({alwaysOnTop})}/>
        <Toggle label="Reduce motion" description="Use fewer transitions and animations" value={settings.reducedMotion} onChange={reducedMotion=>update({reducedMotion})}/>
        <label className="range-label">Panel opacity<span>{Math.max(70,settings.opacity)}%</span><input type="range" min="70" max="100" aria-label="Panel opacity" aria-valuetext={`${Math.max(70,settings.opacity)} percent background opacity`} value={Math.max(70,settings.opacity)} onChange={e=>update({opacity:Number(e.target.value)})}/></label>
      </>}
      {section==='Alerts'&&<>
        <div className="section-intro"><h3>Followed-team alerts</h3><p>These settings apply to clubs you follow. A match bell turns on all alerts for that game.</p></div>
        <Toggle label="Kickoff reminders" value={settings.reminders} onChange={reminders=>update({reminders})}/>
        <label className="select-row">Remind me<select aria-label="Reminder time" value={settings.reminderMinutes} onChange={e=>update({reminderMinutes:Number(e.target.value)})}><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option></select></label>
        <p className="field-note">The reminder time also applies to match bells.</p>
        <Toggle label="Match starting" value={settings.starts} onChange={starts=>update({starts})}/>
        <Toggle label="Goals" description="For followed clubs; match bells can enable goals separately" value={settings.goals} onChange={goals=>update({goals})}/>
        <button className="outline-button" onClick={()=>void test()} disabled={testing} aria-busy={testing}><Bell size={15}/>{testing?'Requesting notification…':'Send test notification'}</button>
        <p className="field-note">Open match details to mute a game or use team settings again.</p>
        {!!Object.keys(settings.matchAlerts).length&&<button className="text-button reset-all" onClick={()=>{panel.current?.focus();update({matchAlerts:{}});}}>Reset match bells to team defaults</button>}
      </>}
      {section==='App'&&<>
        <div className="section-intro"><h3>MatchRadar <span className="version">1.1.0</span></h3><p>Your personal matchday companion.</p></div>
        <Toggle label="Launch with Windows" description={!native?'Available in the desktop app':startupError?'Startup preference unavailable':autostart===null?'Checking startup preference…':'Open MatchRadar when you sign in'} disabled={!native||autostart===null} value={autostart??false} onChange={value=>{void (value?enable():disable()).then(()=>setAutostart(value)).catch(()=>setNotice('Could not change the Windows startup setting.'));}}/>
        {startupError&&<p className="notice" role="status">Could not read the Windows startup setting. Reopen Settings to try again.</p>}
        <div className="about"><CircleHelp size={17}/><p>Scores use ESPN’s unofficial endpoints and may be unavailable or change. MatchRadar is not affiliated with ESPN, the Premier League, or UEFA.</p></div>
        <button className="outline-button" onClick={refresh} disabled={refreshing}><RefreshCw size={15}/>Refresh data</button>
        <p className="field-note">X keeps MatchRadar running in the tray. Choose Quit in the tray to exit.</p>
      </>}
      {notice&&<p className="notice" role="status">{notice}</p>}
    </div>
  </>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { Bell, Check, ChevronDown, CircleHelp, ClipboardCopy, Search } from 'lucide-react';
import { clubs } from '../teams';
import type { Match, Settings, Team } from '../types';
import { Badge, Toggle, ViewHeading } from './WidgetUi';
import { APP_VERSION } from '../version';
import { useApp } from '../store';

const sections = ['Teams','Appearance','Alerts','App'] as const;
type Section = typeof sections[number];
const PREMIER_LEAGUE_CLUBS = 20;

export function SettingsPanel({settings, save, back, matches, backLabel}: {
  settings:Settings; save:(s:Partial<Settings>)=>Promise<unknown>; back:()=>void; matches:Match[]; backLabel?:string;
}) {
  const snapshot = useApp(state=>state.snapshot);
  const [section,setSection] = useState<Section>('Teams');
  const [query,setQuery] = useState('');
  const [showOtherClubs,setShowOtherClubs] = useState(false);
  const [notice,setNotice] = useState('');
  const [autostart,setAutostart] = useState<boolean|null>(null);
  const [startupError,setStartupError] = useState(false);
  const [testing,setTesting] = useState(false);
  const [confirmReset,setConfirmReset] = useState(false);
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const resetConfirmation = useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(confirmReset) resetConfirmation.current?.focus();},[confirmReset]);
  const [opacity,setOpacity] = useState(Math.max(70,settings.opacity));
  const opacityDirty = useRef(false);
  const opacityTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const latestOpacity = useRef(Math.max(70,settings.opacity));
  const setOpacityPreview = useApp(state=>state.setOpacityPreview);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const native = isTauri();
  useEffect(()=>{ if(!opacityDirty.current) setOpacity(Math.max(70,settings.opacity)); },[settings.opacity]);
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
  // The bundled list spans promotion candidates, so it holds more than 20 clubs.
  // Once the fixture window covers a full matchweek the feed is the authority;
  // before that (cold start, international break) fall back to the bundled list.
  const plIds = useMemo(()=>{
    const seen = new Set(matches.filter(m=>m.league==='premierLeague').flatMap(m=>[m.home.id,m.away.id]));
    return seen.size>=PREMIER_LEAGUE_CLUBS ? seen : new Set([...clubs.map(team=>team.id),...seen]);
  },[matches]);
  const followedClubs = favoriteIds.map(id=>byId.get(id)).filter((club): club is Team => !!club).sort((a,b)=>a.name.localeCompare(b.name));
  const unknownFavoriteIds = favoriteIds.filter(id=>!byId.has(id));
  const plClubs = useMemo(()=>{
    const seen = new Set<string>();
    const list: Team[] = [];
    for(const club of [...clubs,...availableClubs]){
      if(plIds.has(club.id)&&!favoriteSet.has(club.id)&&!seen.has(club.id)){seen.add(club.id);list.push(club);}
    }
    return list.sort((a,b)=>a.name.localeCompare(b.name));
  },[availableClubs,favoriteSet,plIds]);
  const otherClubs = availableClubs
    .filter(club=>!plIds.has(club.id)&&!favoriteSet.has(club.id))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const needle = query.trim().toLocaleLowerCase();
  const matchesQuery = (club:Team)=>club.name.toLocaleLowerCase().includes(needle);
  const followedVisible = needle?followedClubs.filter(matchesQuery):followedClubs;
  const plVisible = needle?plClubs.filter(matchesQuery):plClubs;
  const otherVisible = needle?otherClubs.filter(matchesQuery):otherClubs;
  const unknownVisible = needle?unknownFavoriteIds.filter(id=>`unavailable club ${id}`.toLocaleLowerCase().includes(needle)):unknownFavoriteIds;
  const anyVisible = !!followedVisible.length||!!plVisible.length||!!otherVisible.length||!!unknownVisible.length;
  const update = (patch:Partial<Settings>) => {void save(patch);};
  // Dragging the opacity slider must not fsync the whole state on every pixel.
  // Preview locally, then persist once the drag pauses or ends.
  const commitOpacity = (value:number) => {
    if(!opacityDirty.current) return;
    opacityDirty.current = false;
    if(opacityTimer.current){ clearTimeout(opacityTimer.current); opacityTimer.current = undefined; }
    latestOpacity.current = value;
    update({opacity:value});
    setOpacityPreview(null);
  };
  const commitRef = useRef(commitOpacity);
  commitRef.current = commitOpacity;
  useEffect(()=>()=>{
    if(opacityTimer.current) clearTimeout(opacityTimer.current);
    if(opacityDirty.current) commitRef.current(latestOpacity.current);
  },[]);
  const previewOpacity = (value:number) => {
    setOpacity(value);
    latestOpacity.current = value;
    opacityDirty.current = true;
    setOpacityPreview(value);
    if(opacityTimer.current) clearTimeout(opacityTimer.current);
    opacityTimer.current = setTimeout(()=>{ opacityTimer.current = undefined; commitOpacity(value); }, 300);
  };
  const toggleFavorite = (id:string) => {
    const following = favoriteSet.has(id);
    const favorites = following?settings.favorites.filter(favorite=>favorite!==id):[...settings.favorites,id];
    if (following&&!plIds.has(id)) setShowOtherClubs(true);
    update({favorites});
    // The club moves between sections; keep keyboard focus on it.
    setTimeout(()=>(document.getElementById('club-'+id)??search.current)?.focus(),0);
  };
  const clubButton = (club:Team) => <button key={club.id} id={'club-'+club.id} className="club" title={club.name}
    aria-pressed={favoriteSet.has(club.id)} onClick={()=>toggleFavorite(club.id)}>
    <Badge team={club}/><span>{club.name}</span><span className={'check '+(favoriteSet.has(club.id)?'selected':'')} aria-hidden="true">{favoriteSet.has(club.id)&&<Check size={13}/>}</span>
  </button>;
  const activate = (next:Section) => {setSection(next);setNotice('');setConfirmReset(false);if(panel.current) panel.current.scrollTop=0;};
  const tabKey = (event:KeyboardEvent<HTMLButtonElement>, index:number) => {
    const next = event.key==='ArrowRight'?(index+1)%sections.length:event.key==='ArrowLeft'?(index+sections.length-1)%sections.length:event.key==='Home'?0:event.key==='End'?sections.length-1:undefined;
    if(next===undefined) return;
    event.preventDefault();activate(sections[next]);document.getElementById('settings-tab-'+sections[next])?.focus();
  };
  // Everything a bug report needs, nothing personal: no club names or match ids.
  const copyDiagnostics = async () => {
    const report = [
      `MatchRadar ${APP_VERSION} (${native?'desktop':'browser preview'})`,
      `User agent: ${navigator.userAgent}`,
      `Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      `Settings: theme=${settings.theme} view=${settings.competitionView} compact=${settings.compact} onTop=${settings.alwaysOnTop} followed=${settings.favorites.length} bells=${Object.keys(settings.matchAlerts).length}`,
      `Snapshot: matches=${snapshot?.matches.length??0} updated=${snapshot?.updatedAt??'never'} partial=${!!snapshot?.partial} rateLimitedUntil=${snapshot?.rateLimitedUntil??'none'}`,
      ...Object.entries(snapshot?.leagueStatus??{}).map(([league,status])=>`${league}: scores=${status.updatedAt??'never'} fixtures=${status.fixtureUpdatedAt??'never'} results=${status.recentUpdatedAt??'never'}${status.scoreError?` scoreError="${status.scoreError}"`:''}${status.fixtureError?` fixtureError="${status.fixtureError}"`:''}${status.recentError?` resultsError="${status.recentError}"`:''}`),
    ].join('\n');
    try {await navigator.clipboard.writeText(report);setNotice('Diagnostics copied. Paste them into a bug report.');}
    catch {setNotice('Could not copy diagnostics to the clipboard.');}
  };
  const test = async () => {
    setTesting(true);
    try {if(native) await invoke('test_notification');setNotice(native?'Test notification requested. Check Windows notification settings if it does not appear.':'Notifications are available in the desktop app.');}
    catch {setNotice('Could not request a test notification. Check your Windows notification settings.');}
    finally {setTesting(false);}
  };
  return <>
    <ViewHeading title="Settings" eyebrow="MAKE IT YOURS" back={back} backLabel={backLabel}/>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {sections.map((name,index)=><button key={name} role="tab" id={'settings-tab-'+name} aria-controls="settings-panel" aria-selected={section===name} tabIndex={section===name?0:-1} onKeyDown={e=>tabKey(e,index)} onClick={()=>activate(name)}>{name}</button>)}
    </div>
    <div ref={panel} className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={'settings-tab-'+section} tabIndex={0}>
      {section==='Teams'&&<>
        <div className="section-intro"><h3>Your clubs</h3><p>Follow a club once — it counts in the Premier League and Champions League. Clubs appear as their fixtures load.</p></div>
        <label className="search"><Search size={15} aria-hidden="true"/><input ref={search} type="search" aria-label="Search clubs" placeholder="Search clubs" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&query){e.preventDefault();e.stopPropagation();setQuery('');}}}/></label>
        {!!followedVisible.length&&<section className="team-group" aria-labelledby="team-group-followed">
          <h4 id="team-group-followed" className="team-group-title">Followed clubs <span>{followedVisible.length}</span></h4>
          <div className="club-list">{followedVisible.map(clubButton)}</div>
        </section>}
        {!!unknownVisible.length&&<section className="team-group" aria-labelledby="team-group-unknown">
          <h4 id="team-group-unknown" className="team-group-title">Not in this feed <span>{unknownVisible.length}</span></h4>
          <div className="club-list">{unknownVisible.map(id=><button key={id} className="club" aria-pressed="true" aria-label={`Unfollow unavailable club ${id}`} title={`Unfollow unavailable club ${id}`} onClick={()=>toggleFavorite(id)}>
            <span className="badge" aria-hidden="true">?</span><span>Unavailable club{unknownFavoriteIds.length>1?` · ${id}`:''}</span><span className="check selected" aria-hidden="true"><Check size={13}/></span>
          </button>)}</div>
        </section>}
        {!!plVisible.length&&<section className="team-group" aria-labelledby="team-group-premier">
          <h4 id="team-group-premier" className="team-group-title">Premier League clubs <span>{plVisible.length}</span></h4>
          <div className="club-list">{plVisible.map(clubButton)}</div>
        </section>}
        {!!otherClubs.length&&(!needle||!!otherVisible.length)&&<section className="team-group" aria-labelledby="team-group-other">
          {needle
            ? <h4 id="team-group-other" className="team-group-title">Other clubs <span>{otherVisible.length}</span></h4>
            : <button id="team-group-other" className="team-group-title team-group-toggle" aria-expanded={showOtherClubs} aria-controls="other-clubs-list" onClick={()=>setShowOtherClubs(open=>!open)}>Other clubs <small>Outside the Premier League</small> <span>{otherClubs.length}</span><ChevronDown size={14} aria-hidden="true" className={showOtherClubs?'rotated':''}/></button>}
          {(needle||showOtherClubs)&&<div id="other-clubs-list" className="club-list">{otherVisible.map(clubButton)}</div>}
        </section>}
        {!anyVisible&&needle&&<div className="search-empty" role="status"><p>No clubs match “{query}”.</p><button className="text-button" onClick={()=>{search.current?.focus();setQuery('');}}>Clear search</button></div>}
      </>}
      {section==='Appearance'&&<>
        <div className="section-intro"><h3>Appearance</h3><p>Theme, density and desktop visibility.</p></div>
        <label className="select-row">Theme<select aria-label="Theme" value={settings.theme} onChange={e=>{const theme=e.target.value;if(theme==='light'||theme==='dark'||theme==='system') update({theme});}}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
        <Toggle label="Compact layout" description="Tighter spacing and a smaller window. For a one-match strip, use ticker mode in the header." value={settings.compact} onChange={compact=>update({compact})}/>
        {!native&&<p className="field-note">Browser preview changes spacing only. The desktop app also resizes the window.</p>}
        <Toggle label="Always on top" description="Keep the widget above other windows" value={settings.alwaysOnTop} onChange={alwaysOnTop=>update({alwaysOnTop})}/>
        <Toggle label="Reduce motion" description="Use fewer transitions and animations" value={settings.reducedMotion} onChange={reducedMotion=>update({reducedMotion})}/>
        <label className="range-label">Panel opacity<span>{opacity}%</span><input type="range" min="70" max="100" aria-label="Panel opacity" aria-valuetext={`${opacity} percent background opacity`} value={opacity}
          onChange={e=>previewOpacity(Number(e.target.value))}
          onPointerUp={()=>commitOpacity(opacity)}
          onKeyUp={()=>commitOpacity(opacity)}
          onBlur={()=>commitOpacity(opacity)}/></label>
      </>}
      {section==='Alerts'&&<>
        <div className="section-intro"><h3>Followed-team alerts</h3><p>These settings apply to clubs you follow. A match bell turns on all alerts for that game.</p></div>
        <Toggle label="Kick-off reminders" value={settings.reminders} onChange={reminders=>update({reminders})}/>
        <label className="select-row">Remind me<select aria-label="Reminder time" aria-describedby="reminder-help" disabled={!settings.reminders&&!Object.values(settings.matchAlerts).some(alert=>alert.enabled)} value={settings.reminderMinutes} onChange={e=>update({reminderMinutes:Number(e.target.value)})}><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option></select></label>
        <p id="reminder-help" className="field-note">{!settings.reminders&&!Object.values(settings.matchAlerts).some(alert=>alert.enabled)?'Turn on kick-off reminders or a match bell to change the reminder time.':'The reminder time also applies to match bells.'}</p>
        <Toggle label="Match starting" value={settings.starts} onChange={starts=>update({starts})}/>
        <Toggle label="Goals" description="For followed clubs; match bells can enable goals separately" value={settings.goals} onChange={goals=>update({goals})}/>
        <button className="outline-button" onClick={()=>void test()} disabled={testing} aria-busy={testing}><Bell size={15}/>{testing?'Requesting notification…':'Send test notification'}</button>
        <p className="field-note">Use the bell on a match, in the list or in match details, to turn alerts on, mute a game, or return to team defaults.</p>
        {!!Object.keys(settings.matchAlerts).length&&(confirmReset?<div role="group" aria-label="Confirm reset match bells"><p>Reset all match bells to team defaults?</p><button ref={resetConfirmation} className="text-button" onClick={()=>{setConfirmReset(false);panel.current?.focus();update({matchAlerts:{}});}}>Confirm reset</button><button className="text-button" onClick={()=>{setConfirmReset(false);requestAnimationFrame(()=>resetTrigger.current?.focus());}}>Cancel</button></div>:<button ref={resetTrigger} className="text-button reset-all" onClick={()=>setConfirmReset(true)}>Reset match bells to team defaults</button>)}
      </>}
      {section==='App'&&<>
        <div className="section-intro"><h3>MatchRadar <span className="version">{APP_VERSION}</span></h3><p>Your personal matchday companion.</p></div>
        <Toggle label="Launch with Windows" description={!native?'Available in the desktop app':startupError?'Startup preference unavailable':autostart===null?'Checking startup preference…':'Open MatchRadar when you sign in'} disabled={!native||autostart===null} value={autostart??false} onChange={value=>{void (value?enable():disable()).then(()=>setAutostart(value)).catch(()=>setNotice('Could not change the Windows startup setting.'));}}/>
        <Toggle label="Start hidden in tray" description={!native?'Available in the desktop app':autostart!==true?'Enable Launch with Windows to use this setting':'Launch with Windows without opening the widget'} disabled={!native||autostart!==true} value={settings.startHidden} onChange={startHidden=>update({startHidden})}/>
        {startupError&&<p className="notice" role="status">Could not read the Windows startup setting. Reopen Settings to try again.</p>}
        <div className="about"><CircleHelp size={17}/><p>Scores use ESPN’s unofficial endpoints and may be unavailable or change. MatchRadar is not affiliated with ESPN, the Premier League, or UEFA.</p></div>
        <button className="outline-button" onClick={()=>void copyDiagnostics()} title="Copy version, settings summary and feed status for a bug report"><ClipboardCopy size={15}/>Copy diagnostics</button>
        <p className="field-note">MatchRadar lives in the system tray. The X button hides it there; click the tray icon or press Ctrl+Shift+M anywhere to show it again, and choose Quit in the tray to exit.</p>
      </>}
      {notice&&<p className="notice" role="status">{notice}</p>}
    </div>
  </>;
}

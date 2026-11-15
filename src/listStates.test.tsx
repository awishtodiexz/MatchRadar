// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { mockSnapshot } from './test-fixtures/fixtures';
import { useApp } from './store';
import type { Snapshot } from './types';

vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{})}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:vi.fn()}));
vi.mock('@tauri-apps/plugin-autostart',()=>({isEnabled:vi.fn(),enable:vi.fn(),disable:vi.fn()}));
const detailName = /Match details:.*Arsenal.*Chelsea/;
const inheritName = 'Match alerts: Arsenal versus Chelsea, Team default';
it('uses the system-light paint hint before desktop settings load', () => {
  vi.stubGlobal('localStorage',{getItem:vi.fn(()=> 'system'),setItem:vi.fn()});
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  useApp.setState({snapshot:null,loading:true,error:null});
  const {container} = render(<App/>);
  expect(container.querySelector('.theme-light')).toBeTruthy();
  vi.unstubAllGlobals();
});
async function load(snapshot:Snapshot) {
  useApp.setState({snapshot,loading:false,error:null});
  await useApp.getState().load();
}
const openMatchAlerts = () => fireEvent.click(screen.getByRole('button',{name:/^Match alerts: /}));
beforeEach(async()=>{await load(structuredClone(mockSnapshot));});
afterEach(cleanup);

describe('list states',()=>{
  it('distinguishes a quiet live view from a failed scoreboard and hidden live matches',async()=>{
    const base=structuredClone(mockSnapshot);
    await load({...base,matches:base.matches.filter(m=>m.status==='scheduled'),updatedAt:'2026-10-29T12:00:00Z'});
    const {unmount}=render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Live'}));
    expect(screen.getByText('No Premier League matches are live right now')).toBeTruthy();
    unmount();
    await load({...base,matches:base.matches.filter(m=>m.status==='scheduled'),scoreError:'HTTP 500',error:'Scores failed'});
    const failed=render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Live'}));
    expect(screen.getByText('Live status unavailable')).toBeTruthy();expect(screen.queryByText('No Premier League matches are live right now')).toBeNull();
    failed.unmount();
    await load({...base,settings:{...base.settings,followedOnly:true,favorites:[]}});
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Live'}));
    expect(screen.queryByRole('button',{name:detailName})).toBeNull();
    expect(screen.getByText('No followed clubs are live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Show all matches'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:detailName})).toBeTruthy());
    expect(screen.getByRole('button',{name:'Live'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText(/Premier League: .* live matches/)).toBeTruthy();
  });
  it('explains when the Following view has no matching clubs',async()=>{
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,favorites:[]}});
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Following only'}));
    expect(screen.getByText('No matches involving followed clubs')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Show all matches'})).toBeTruthy();
  });
  it('does not claim live status is unavailable while the first feed check is in flight',async()=>{
    await load({...structuredClone(mockSnapshot),matches:[],updatedAt:null,fixtureUpdatedAt:null,refreshing:true});
    render(<App/>);
    expect(screen.getByText('CHECKING LIVE',{exact:true})).toBeTruthy();
    expect(screen.queryByText('LIVE UNAVAILABLE')).toBeNull();
    expect(screen.getByLabelText(/checking live status/)).toBeTruthy();
  });
  it('presents a failed first load as an error with recovery instead of an empty schedule',async()=>{
    useApp.setState({snapshot:null,loading:false,error:'Could not load the widget state.'});
    render(<App/>);
    expect(await screen.findByRole('heading',{name:'Unable to load matches'})).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not load the widget state.');
    expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();
    expect(screen.getByText('NOT CONNECTED')).toBeTruthy();
    expect(document.querySelector('.error-banner')).toBeNull();
  });
  it('returns focus to the first recovered card after showing filtered-out matches',async()=>{
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,favorites:[],followedOnly:true}});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'Show all matches'}));
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:detailName})));
  });
  it('exposes the score and status as the match card description',()=>{
    render(<App/>);
    const card=screen.getByRole('button',{name:detailName});
    const description=document.getElementById(card.getAttribute('aria-describedby')??'');
    expect(description?.textContent).toContain('2 to 1');
  });
  it('describes an empty Upcoming view as empty rather than as an active filter',async()=>{
    const base=structuredClone(mockSnapshot);
    await load({...base,matches:base.matches.filter(m=>m.status!=='scheduled')});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'Upcoming'}));
    expect(screen.getByText('No upcoming matches')).toBeTruthy();
    expect(screen.queryByText(/active filters hide/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show all matches'}));
    expect(screen.getByRole('button',{name:detailName})).toBeTruthy();
  });
  it('lets a stale followed-club id be removed when it is absent from the feed',async()=>{
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,favorites:['999']}});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    expect(screen.getByText('Unavailable club')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Unfollow unavailable club 999'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.favorites).not.toContain('999'));
  });
  it('closes the match alert menu when keyboard focus leaves it',()=>{
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:inheritName}));
    expect(screen.getByRole('dialog',{name:'Match alerts'})).toBeTruthy();
    fireEvent.focusIn(screen.getByRole('button',{name:'Settings'}));
    expect(screen.queryByRole('dialog',{name:'Match alerts'})).toBeNull();
  });
  it('suppresses surface context menus on cards, icons, details and settings',()=>{
    render(<App/>);
    expect(fireEvent.contextMenu(screen.getByRole('navigation',{name:'Fixture views'}))).toBe(false);
    const card=screen.getByRole('button',{name:detailName});
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole('button',{name:inheritName}).querySelector('svg')!)).toBe(false);
    fireEvent.click(card);
    expect(fireEvent.contextMenu(screen.getByRole('heading',{name:'Match details'}))).toBe(false);
    openMatchAlerts();
    expect(fireEvent.contextMenu(screen.getByRole('heading',{name:'Match alerts'}))).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    expect(fireEvent.contextMenu(screen.getByRole('heading',{name:'Your clubs'}))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole('searchbox',{name:'Search clubs'}))).toBe(true);
    fireEvent.change(screen.getByRole('searchbox',{name:'Search clubs'}),{target:{value:'Arsenal'}});
    expect(screen.getByRole('button',{name:'Arsenal'})).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Appearance'}));
    expect(fireEvent.contextMenu(screen.getByRole('combobox',{name:'Theme'}))).toBe(true);
  });

  it('preserves context menus for copyable errors and editable descendants',()=>{
    render(<App/>);
    act(()=>useApp.setState({error:'Could not save settings. Please try again.'}));
    expect(fireEvent.contextMenu(screen.getByText('Could not save settings. Please try again.'))).toBe(true);
    const main=screen.getByRole('main');
    const textarea=document.createElement('textarea');main.append(textarea);
    expect(fireEvent.contextMenu(textarea)).toBe(true);
    const editor=document.createElement('div');const child=document.createElement('span');
    editor.append(child);main.append(editor);
    for(const value of ['', 'true', 'plaintext-only']) {
      editor.setAttribute('contenteditable',value);
      expect(fireEvent.contextMenu(child)).toBe(true);
    }
    child.setAttribute('contenteditable','false');
    expect(fireEvent.contextMenu(child)).toBe(false);
    editor.remove();textarea.remove();
  });

  it('keeps league-wide live counts when only followed cards are shown and can clear an empty filter',async()=>{
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,favorites:[],followedOnly:true}});
    render(<App/>);
    expect(screen.getByLabelText('Premier League: 4 live matches, all clubs').textContent).toBe('4 LIVE');
    expect(screen.queryByText('NO LIVE MATCHES')).toBeNull();
    expect(screen.getByRole('heading',{name:'No matches involving followed clubs'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:detailName})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show all matches'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:detailName})).toBeTruthy());
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.followedOnly).toBe(false));
    expect(screen.getByRole('button',{name:'All'}).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps saved league scores distinct even when the filter hides every card',async()=>{
    await load({...structuredClone(mockSnapshot),matches:mockSnapshot.matches.map(m=>({...m,scoreStale:true})),settings:{...mockSnapshot.settings,favorites:[],followedOnly:true}});
    render(<App/>);
    expect(screen.getByLabelText(/Premier League: 4 in-progress matches, including saved scores/).textContent).toBe('4 LIVE · SAVED');
    expect(screen.queryByText('NO LIVE MATCHES')).toBeNull();
  });

  it('resets one match to team settings without deleting other subscriptions',async()=>{
    const other = {enabled:false,expiresAt:'2026-12-01T00:00:00Z'};
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,matchAlerts:{'demo-2':other}}});
    render(<App/>);
    const bell=screen.getByRole('button',{name:inheritName});
    expect(bell.getAttribute('data-alert-state')).toBe('team');
    fireEvent.click(bell);
    fireEvent.click(screen.getByRole('button',{name:'On'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(true));
    expect(screen.getByRole('button',{name:'Match alerts: Arsenal versus Chelsea, On'}).getAttribute('data-alert-state')).toBe('on');
    fireEvent.keyDown(screen.getByRole('dialog',{name:'Match alerts'}),{key:'Escape'});
    fireEvent.click(screen.getByRole('button',{name:detailName}));
    openMatchAlerts();
    expect(screen.getByRole('button',{name:'On'}).getAttribute('aria-pressed')).toBe('true');
    const reset=screen.getByRole('button',{name:'Team default'});reset.focus();fireEvent.click(reset);
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.matchAlerts).toEqual({'demo-2':other}));
    expect(screen.getByRole('button',{name:'Team default'}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog',{name:'Match alerts'}),{key:'Escape'});
    fireEvent.click(screen.getByRole('button',{name:'Back to matches'}));
    expect(screen.getByRole('button',{name:inheritName}).getAttribute('data-alert-state')).toBe('team');
  });

  it('distinguishes explicit mute from team defaults in names, tooltips and visual state',async()=>{
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:inheritName}));
    fireEvent.click(screen.getByRole('button',{name:'Muted'}));
    const muted=await screen.findByRole('button',{name:'Match alerts: Arsenal versus Chelsea, Muted'});
    expect(muted.getAttribute('data-alert-state')).toBe('muted');
    expect(screen.getByText(/even for followed clubs/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'Muted'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button',{name:/Match alerts: Brighton & Hove Albion versus Everton/})).toBeNull();
  });

  it('does not offer ended-match alert actions when no override exists',()=>{
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:/Match details:.*Brighton & Hove Albion.*Everton/}));
    expect(screen.queryByRole('button',{name:/^Match alerts:/})).toBeNull();
  });

  it('offers no alert actions for ended subscribed matches',async()=>{
    const base=structuredClone(mockSnapshot);
    await load({...base,settings:{...base.settings,matchAlerts:{'demo-5':{enabled:true,expiresAt:'2099-01-01T00:00:00Z'}}}});
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:/Match details:.*Brighton & Hove Albion.*Everton/}));
    expect(screen.queryByRole('button',{name:/^Match alerts:/})).toBeNull();
    expect(useApp.getState().snapshot?.settings.matchAlerts['demo-5'].enabled).toBe(true);
  });

  it('labels a cancelled match as cancelled rather than as having ended',()=>{
    render(<App/>);
    expect(screen.queryByRole('button',{name:/Match alerts: Everton versus Wolverhampton Wanderers/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/Match details:.*Everton.*Wolverhampton Wanderers/}));
    expect(screen.queryByRole('button',{name:/^Match alerts:/})).toBeNull();
    expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0);
  });

  it('explains that a postponed match can alert again after it is rescheduled',()=>{
    render(<App/>);
    const bell=screen.getByRole('button',{name:'Match alerts: Wolverhampton Wanderers versus West Ham United, Team default'});
    expect(bell.hasAttribute('disabled')).toBe(false);
    fireEvent.click(bell);
    expect(screen.getByText(/postponed; alerts resume if it is rescheduled/)).toBeTruthy();
  });

  it('keeps keyboard focus in Settings after resetting all match alerts',async()=>{
    const base=structuredClone(mockSnapshot);
    await load({...base,settings:{...base.settings,matchAlerts:{'demo-1':{enabled:true,expiresAt:'2099-01-01T00:00:00Z'}}}});
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Settings'}));fireEvent.click(screen.getByRole('tab',{name:'Alerts'}));
    const reset=screen.getByRole('button',{name:'Reset match bells to team defaults'});reset.focus();fireEvent.click(reset);
    fireEvent.click(screen.getByRole('button',{name:'Confirm reset'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Reset match bells to team defaults'})).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('tabpanel',{name:'Alerts'}));
    fireEvent.keyDown(document.activeElement??document.body,{key:'Escape'});
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Settings'}));
  });

  it('returns focus to club search after clearing an empty result',()=>{
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    const search=screen.getByRole('searchbox',{name:'Search clubs'});fireEvent.change(search,{target:{value:'zzzzzz'}});
    const clear=screen.getByRole('button',{name:'Clear search'});clear.focus();fireEvent.click(clear);
    expect(document.activeElement).toBe(search);expect((search as HTMLInputElement).value).toBe('');
  });

  it('moves focus into details and restores the originating card and scroll position on Escape',()=>{
    render(<App/>);
    const card=screen.getByRole('button',{name:detailName});
    card.focus();
    const list=document.querySelector('.match-list');if(list) list.scrollTop=123;
    fireEvent.click(card);
    expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Match details'}));
    fireEvent.keyDown(document.activeElement??document.body,{key:'Escape'});
    expect(document.activeElement).toBe(screen.getByRole('button',{name:detailName}));
    expect(document.querySelector('.match-list')?.scrollTop).toBe(123);
  });

  it('updates an open match from fresh snapshots and keeps it visible when temporarily absent',()=>{
    render(<App/>);fireEvent.click(screen.getByRole('button',{name:detailName}));
    act(()=>useApp.setState({snapshot:{...mockSnapshot,matches:mockSnapshot.matches.map(m=>m.id==='demo-1'?{...m,homeScore:3,detail:"72'"}:m)}}));
    expect(document.querySelector('.detail-score')?.textContent).toContain('3 – 1');
    expect(document.querySelector('.detail-status')?.textContent).toContain("72'");
    act(()=>useApp.setState({snapshot:{...mockSnapshot,matches:mockSnapshot.matches.filter(m=>m.id!=='demo-1')}}));
    expect(screen.getByRole('heading',{name:'Match details'})).toBeTruthy();
    expect(document.querySelector('.detail-score')?.textContent).toContain('3 – 1');
    expect(document.querySelector('.detail-score')?.textContent).toContain('Saved');
    act(()=>useApp.setState({snapshot:{...mockSnapshot,matches:mockSnapshot.matches.map(m=>m.id==='demo-1'?{...m,homeScore:4,detail:"80'"}:m)}}));
    expect(document.querySelector('.detail-score')?.textContent).toContain('4 – 1');
    expect(document.querySelector('.detail-score')?.textContent).not.toContain('Saved');
  });

  it('announces selected tabs, implements arrow/Home/End navigation and restores Settings focus',()=>{
    render(<App/>);
    const settings=screen.getByRole('button',{name:'Settings'});
    fireEvent.click(settings);
    expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Settings'}));
    const teams=screen.getByRole('tab',{name:'Teams'});
    for(const tab of screen.getAllByRole('tab')) expect(document.getElementById(tab.getAttribute('aria-controls')??'')).toBe(screen.getByRole('tabpanel'));
    expect(teams.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab',{name:'Appearance'}).tabIndex).toBe(-1);
    teams.focus();fireEvent.keyDown(teams,{key:'ArrowRight'});
    const appearance=screen.getByRole('tab',{name:'Appearance'});
    expect(document.activeElement).toBe(appearance);
    expect(appearance.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel',{name:'Appearance'})).toBeTruthy();
    fireEvent.keyDown(appearance,{key:'End'});
    expect(document.activeElement).toBe(screen.getByRole('tab',{name:'App'}));
    fireEvent.keyDown(document.activeElement??document.body,{key:'Home'});
    expect(document.activeElement).toBe(teams);
    fireEvent.keyDown(teams,{key:'ArrowLeft'});
    expect(document.activeElement).toBe(screen.getByRole('tab',{name:'App'}));
    fireEvent.keyDown(document.activeElement??document.body,{key:'ArrowRight'});
    expect(document.activeElement).toBe(teams);
    fireEvent.keyDown(teams,{key:'Escape'});
    expect(document.activeElement).toBe(settings);
  });

  it('separates valid empty schedules, startup loading and failed requests while preserving cached matches',async()=>{
    await load({...structuredClone(mockSnapshot),matches:[]});
    const {unmount}=render(<App/>);
    expect(screen.getByRole('heading',{name:'No fixtures in this window'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();
    act(()=>{useApp.setState({snapshot:{...mockSnapshot,matches:[],error:'HTTP 500',scoreError:'HTTP 500'}});});
    expect(screen.getByRole('heading',{name:'Unable to update matches'})).toBeTruthy();
    expect(screen.getAllByRole('button',{name:'Retry'})).toHaveLength(1);
    expect(screen.getByLabelText('Premier League: live status unavailable')).toBeTruthy();
    act(()=>{useApp.setState({snapshot:{...mockSnapshot,error:'HTTP 500'}});});
    expect(screen.getByRole('button',{name:detailName})).toBeTruthy();
    expect(screen.queryByLabelText('Loading fixtures')).toBeNull();
    unmount();
    await load({...mockSnapshot,matches:[],updatedAt:null,fixtureUpdatedAt:null,refreshing:true});
    render(<App/>);
    expect(screen.getByLabelText('Loading fixtures')).toBeTruthy();
  });

  it('explains native-only controls and provides full club names without changing compact on tab switches',async()=>{
    render(<App/>);
    expect(screen.getByRole('button',{name:'Hide widget'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Wolverhampton Wanderers')[0].title).toBe('Wolverhampton Wanderers');
    fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    fireEvent.click(screen.getByRole('tab',{name:'Appearance'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'Compact layout'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.compact).toBe(true));
    fireEvent.click(screen.getByRole('tab',{name:'App'}));
    expect(screen.getByRole('checkbox',{name:'Launch with Windows'}).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('tab',{name:'Teams'}));
    expect(useApp.getState().snapshot?.settings.compact).toBe(true);
  });
  it('keeps match alert controls usable when a saved kickoff is malformed',async()=>{
    const broken={...structuredClone(mockSnapshot.matches[0]),kickoff:'not-a-date'};
    await load({...structuredClone(mockSnapshot),matches:[broken]});
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:/Match alerts: Arsenal versus Chelsea/}));
    fireEvent.click(screen.getByRole('button',{name:'On'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.matchAlerts[broken.id]?.enabled).toBe(true));
    expect(useApp.getState().snapshot?.settings.matchAlerts[broken.id]?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { mockSnapshot } from './mock';
import { useApp } from './store';
import type { Snapshot } from './types';

vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn().mockResolvedValue(()=>{})}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:vi.fn()}));
vi.mock('@tauri-apps/plugin-autostart',()=>({isEnabled:vi.fn(),enable:vi.fn(),disable:vi.fn()}));
const detailName = 'Match details: Arsenal versus Chelsea';
const inheritName = 'Enable all alerts (using team settings): Arsenal versus Chelsea';
async function load(snapshot:Snapshot) {
  useApp.setState({snapshot,loading:false,error:null});
  await useApp.getState().load();
}
beforeEach(async()=>{await load(structuredClone(mockSnapshot));});
afterEach(cleanup);

describe('focused usability refinements',()=>{
  it('suppresses surface context menus on cards, icons, details and settings',()=>{
    render(<App/>);
    expect(fireEvent.contextMenu(screen.getByRole('heading',{name:'Matchday .'}))).toBe(false);
    const card=screen.getByRole('button',{name:detailName});
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole('button',{name:inheritName}).querySelector('svg')!)).toBe(false);
    fireEvent.click(card);
    expect(fireEvent.contextMenu(screen.getByRole('heading',{name:'Match details'}))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByText('Event details aren’t available from this feed yet.'))).toBe(false);
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
    expect(screen.getByLabelText('Premier League: 2 live matches').textContent).toBe('2 LIVE');
    expect(screen.queryByText('NO LIVE MATCHES')).toBeNull();
    expect(screen.getByRole('heading',{name:'No followed-team matches'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:detailName})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show all matches'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:detailName})).toBeTruthy());
    expect(useApp.getState().snapshot?.settings.followedOnly).toBe(false);
    expect(screen.getByRole('button',{name:'Following only'}).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps saved league scores distinct even when the filter hides every card',async()=>{
    await load({...structuredClone(mockSnapshot),matches:mockSnapshot.matches.map(m=>({...m,scoreStale:true})),settings:{...mockSnapshot.settings,favorites:[],followedOnly:true}});
    render(<App/>);
    expect(screen.getByLabelText('Premier League: saved scores, awaiting live update').textContent).toBe('SAVED LIVE');
    expect(screen.queryByText('NO LIVE MATCHES')).toBeNull();
  });

  it('resets one match to team settings without deleting other subscriptions',async()=>{
    const other = {enabled:false,expiresAt:'2026-12-01T00:00:00Z'};
    await load({...structuredClone(mockSnapshot),settings:{...mockSnapshot.settings,matchAlerts:{'demo-2':other}}});
    render(<App/>);
    const bell=screen.getByRole('button',{name:inheritName});
    expect(bell.getAttribute('data-alert-state')).toBe('team');
    fireEvent.click(bell);
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.matchAlerts['demo-1'].enabled).toBe(true));
    expect(screen.getByRole('button',{name:'Mute match alerts (all alerts on): Arsenal versus Chelsea'}).getAttribute('data-alert-state')).toBe('on');
    fireEvent.click(screen.getByRole('button',{name:detailName}));
    expect(screen.getByText('All alerts on',{exact:true})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Use team settings'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.matchAlerts).toEqual({'demo-2':other}));
    expect(screen.getByText('Team settings',{exact:true})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Back to matches'}));
    expect(screen.getByRole('button',{name:inheritName}).getAttribute('data-alert-state')).toBe('team');
  });

  it('distinguishes explicit mute from team defaults in names, tooltips and visual state',async()=>{
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:inheritName}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Mute match alerts (all alerts on): Arsenal versus Chelsea'})).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'Mute match alerts (all alerts on): Arsenal versus Chelsea'}));
    const muted=await screen.findByRole('button',{name:'Enable all alerts (match muted): Arsenal versus Chelsea'});
    expect(muted.getAttribute('data-alert-state')).toBe('muted');
    expect(muted.title).toContain('even for followed clubs');
    expect(muted.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button',{name:'Match ended: Brighton & Hove Albion versus Everton'}).hasAttribute('disabled')).toBe(true);
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
    expect(screen.getByRole('button',{name:'Minimize widget'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Wolverhampton Wanderers').title).toBe('Wolverhampton Wanderers');
    fireEvent.click(screen.getByRole('button',{name:'Settings'}));
    fireEvent.click(screen.getByRole('tab',{name:'Appearance'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'Compact view'}));
    await waitFor(()=>expect(useApp.getState().snapshot?.settings.compact).toBe(true));
    fireEvent.click(screen.getByRole('tab',{name:'App'}));
    expect(screen.getByRole('checkbox',{name:'Launch with Windows'}).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('tab',{name:'Teams'}));
    expect(useApp.getState().snapshot?.settings.compact).toBe(true);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './components/SettingsPanel';
import { defaults, mockMatches } from './test-fixtures/fixtures';
import type { Settings } from './types';

afterEach(cleanup);

function show(settings: Settings = defaults) {
  const save = vi.fn<(patch: Partial<Settings>) => Promise<void>>(async () => {});
  const onKeyDown = vi.fn();
  const view = render(<div onKeyDown={onKeyDown}><SettingsPanel settings={settings} save={save} back={()=>{}} matches={mockMatches} refresh={()=>{}} refreshing={false}/></div>);
  return {save,onKeyDown,...view};
}

describe('settings audit', () => {
  it('clears a nonempty search before letting Escape reach the parent', () => {
    const {onKeyDown} = show();
    const search = screen.getByRole('searchbox', {name:'Search clubs'});
    fireEvent.change(search, {target:{value:'Arsenal'}});
    fireEvent.keyDown(search, {key:'Escape'});
    expect((search as HTMLInputElement).value).toBe('');
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(search, {key:'Escape'});
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(screen.queryByRole('checkbox', {name:'Following only'})).toBeNull();
  });

  it('sorts club groups and allows removing unavailable favorites', () => {
    const {save} = show({...defaults,favorites:['363','359','missing']});
    const followed = screen.getByRole('region', {name:/Followed clubs/});
    expect(within(followed).getAllByRole('button').map(button=>button.textContent)).toEqual(['Arsenal','Chelsea']);
    fireEvent.click(screen.getByRole('button', {name:'Unfollow unavailable club missing'}));
    expect(save).toHaveBeenCalledWith({favorites:['363','359']});
  });

  it('visibly distinguishes multiple unavailable favorites and preserves removal focus', async () => {
    show({...defaults,favorites:['missing-one','missing-two']});
    expect(screen.getByText('Unavailable club · missing-one')).toBeTruthy();
    expect(screen.getByText('Unavailable club · missing-two')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name:'Unfollow unavailable club missing-one'}));
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('searchbox', {name:'Search clubs'})));
  });

  it('keeps reminder timing available for enabled match bells', () => {
    const {rerender} = show({...defaults,reminders:false});
    fireEvent.click(screen.getByRole('tab', {name:'Alerts'}));
    expect((screen.getByRole('combobox', {name:'Reminder time'}) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Turn on kick-off reminders or a match bell/)).toBeTruthy();
    rerender(<div><SettingsPanel settings={{...defaults,reminders:false,matchAlerts:{game:{enabled:true,expiresAt:'2030-01-01'}}}} save={async()=>{}} back={()=>{}} matches={mockMatches} refresh={()=>{}} refreshing={false}/></div>);
    expect((screen.getByRole('combobox', {name:'Reminder time'}) as HTMLSelectElement).disabled).toBe(false);
  });

  it('requires confirmation before resetting match overrides', () => {
    const {save} = show({...defaults,matchAlerts:{game:{enabled:false,expiresAt:'2030-01-01'}}});
    fireEvent.click(screen.getByRole('tab', {name:'Alerts'}));
    fireEvent.click(screen.getByRole('button', {name:'Reset match bells to team defaults'}));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', {name:'Confirm reset'}));
    fireEvent.click(screen.getByRole('button', {name:'Cancel'}));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Reset match bells to team defaults'}));
    fireEvent.click(screen.getByRole('button', {name:'Confirm reset'}));
    expect(save).toHaveBeenCalledWith({matchAlerts:{}});
  });

  it('saves system theme without changing other preferences', () => {
    const {save} = show({...defaults,followedOnly:true});
    fireEvent.click(screen.getByRole('tab', {name:'Appearance'}));
    fireEvent.change(screen.getByRole('combobox', {name:'Theme'}), {target:{value:'system'}});
    expect(save).toHaveBeenCalledWith({theme:'system'});
  });
});

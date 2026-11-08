// @vitest-environment jsdom
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { useMatchSummary } from './useMatchSummary';
import type { MatchSummary } from './useMatchSummary';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:bridge.invoke}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.restoreAllMocks();vi.useRealTimers();});
const detail=(id:string):MatchSummary=>({matchId:id,venue:null,events:[],statistics:[],players:[],updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false});
it('ignores a previous match response after rapid navigation',async()=>{
 const pending:Array<(v:MatchSummary)=>void>=[];bridge.invoke.mockImplementation(()=>new Promise(r=>pending.push(r)));
 const {result,rerender}=renderHook(({id})=>useMatchSummary(id,false),{initialProps:{id:'1'}});
 rerender({id:'2'});await act(async()=>pending[1](detail('2')));await act(async()=>pending[0](detail('1')));
 expect(result.current.data?.matchId).toBe('2');
});
it('reports errors and retries on demand',async()=>{bridge.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail('1'));const {result}=renderHook(()=>useMatchSummary('1',false));await waitFor(()=>expect(result.current.error).toBeTruthy());act(()=>result.current.retry());await waitFor(()=>expect(result.current.data?.matchId).toBe('1'));});

it('retains cached details during a retry and marks them saved on IPC failure',async()=>{
 bridge.invoke.mockResolvedValueOnce(detail('1')).mockRejectedValueOnce(new Error('offline'));
 const {result}=renderHook(()=>useMatchSummary('1',false));await waitFor(()=>expect(result.current.data?.matchId).toBe('1'));
 act(()=>result.current.retry());expect(result.current.data?.matchId).toBe('1');
 await waitFor(()=>expect(result.current.error).toBeTruthy());expect(result.current.data?.stale).toBe(true);
});
it('polls only an open active match and stops after unmount',async()=>{
 vi.useFakeTimers();bridge.invoke.mockResolvedValue(detail('1'));
 const {unmount}=renderHook(()=>useMatchSummary('1',true));
 await act(async()=>{});expect(bridge.invoke).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(bridge.invoke).toHaveBeenCalledTimes(2);
 unmount();await act(async()=>vi.advanceTimersByTimeAsync(180000));expect(bridge.invoke).toHaveBeenCalledTimes(2);
});
it('rejects a mismatched native response without displaying another match',async()=>{
 bridge.invoke.mockResolvedValue(detail('2'));const {result}=renderHook(()=>useMatchSummary('1',false));await waitFor(()=>expect(result.current.error).toBeTruthy());expect(result.current.data).toBeNull();
});

it('pauses detail polling while hidden and reconciles on visibility return',async()=>{
 vi.useFakeTimers();let visibility:DocumentVisibilityState='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility);bridge.invoke.mockResolvedValue(detail('1'));
 const {unmount}=renderHook(()=>useMatchSummary('1',true));await act(async()=>{});expect(bridge.invoke).toHaveBeenCalledTimes(1);
 visibility='hidden';act(()=>document.dispatchEvent(new Event('visibilitychange')));await act(async()=>vi.advanceTimersByTimeAsync(180000));expect(bridge.invoke).toHaveBeenCalledTimes(1);
 visibility='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(bridge.invoke).toHaveBeenCalledTimes(2);unmount();
});

it('fetches on full-time transition and retries until the provider confirms final details',async()=>{
 vi.useFakeTimers();
 bridge.invoke.mockResolvedValueOnce({...detail('1'),matchState:'in'})
  .mockResolvedValueOnce({...detail('1'),matchState:'in'})
  .mockResolvedValue({...detail('1'),matchState:'post'});
 const {rerender,unmount}=renderHook(({active,finished})=>useMatchSummary('1',active,finished),{initialProps:{active:true,finished:false}});
 await act(async()=>{});expect(bridge.invoke).toHaveBeenCalledTimes(1);
 rerender({active:false,finished:true});await act(async()=>{});expect(bridge.invoke).toHaveBeenCalledTimes(2);
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(bridge.invoke).toHaveBeenCalledTimes(3);
 await act(async()=>vi.advanceTimersByTimeAsync(180000));expect(bridge.invoke).toHaveBeenCalledTimes(3);unmount();
});
it('continues final reconciliation after an IPC failure while retaining saved data',async()=>{
 vi.useFakeTimers();bridge.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({...detail('1'),matchState:'post'});
 const {result,unmount}=renderHook(()=>useMatchSummary('1',false,true));
 await act(async()=>{});expect(result.current.error).toBeTruthy();
 await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(result.current.data?.matchState).toBe('post');
 expect(bridge.invoke).toHaveBeenCalledTimes(2);unmount();
});

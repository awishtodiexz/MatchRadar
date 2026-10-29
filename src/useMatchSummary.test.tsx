// @vitest-environment jsdom
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { useMatchSummary } from './useMatchSummary';
import type { MatchSummary } from './useMatchSummary';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:bridge.invoke}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const detail=(id:string):MatchSummary=>({matchId:id,events:[],statistics:[],players:[],updatedAt:'2026-10-29T12:00:00Z',error:null,stale:false});
it('does not fetch summaries in demo mode',()=>{renderHook(()=>useMatchSummary('demo-1',true,true));expect(bridge.invoke).not.toHaveBeenCalled();});
it('ignores a previous match response after rapid navigation',async()=>{
 const pending:Array<(v:MatchSummary)=>void>=[];bridge.invoke.mockImplementation(()=>new Promise(r=>pending.push(r)));
 const {result,rerender}=renderHook(({id})=>useMatchSummary(id,false,false),{initialProps:{id:'1'}});
 rerender({id:'2'});await act(async()=>pending[1](detail('2')));await act(async()=>pending[0](detail('1')));
 expect(result.current.data?.matchId).toBe('2');
});
it('reports errors and retries on demand',async()=>{bridge.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail('1'));const {result}=renderHook(()=>useMatchSummary('1',false,false));await waitFor(()=>expect(result.current.error).toBeTruthy());act(()=>result.current.retry());await waitFor(()=>expect(result.current.data?.matchId).toBe('1'));});

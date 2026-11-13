// @vitest-environment jsdom
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { useRecentResults } from './useRecentResults';
import type { CompetitionView } from './types';
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:bridge.invoke}));afterEach(()=>{cleanup();vi.resetAllMocks();});
it('requests only when Results opens, retaining data after an error',async()=>{bridge.invoke.mockResolvedValueOnce({matches:[],updatedAt:'2026-10-29T00:00:00Z',error:null}).mockRejectedValueOnce(new Error('offline'));const {result,rerender}=renderHook(({enabled})=>useRecentResults(enabled),{initialProps:{enabled:false}});expect(bridge.invoke).not.toHaveBeenCalled();rerender({enabled:true});await waitFor(()=>expect(result.current.data.updatedAt).toBeTruthy());act(()=>result.current.retry());await waitFor(()=>expect(result.current.data.error).toBeTruthy());expect(result.current.data.updatedAt).toBe('2026-10-29T00:00:00Z');});
it('shows loading while a manual retry is pending',async()=>{
 bridge.invoke.mockResolvedValueOnce({matches:[],updatedAt:'first',error:null});
 const {result}=renderHook(()=>useRecentResults(true));
 await waitFor(()=>expect(result.current.data.updatedAt).toBe('first'));
 let resolve!:(x:unknown)=>void;
 bridge.invoke.mockImplementation(()=>new Promise(r=>resolve=r));
 act(()=>result.current.retry());
 expect(result.current.loading).toBe(true);
 await waitFor(()=>expect(bridge.invoke).toHaveBeenCalledTimes(2));
 await act(async()=>resolve({matches:[],updatedAt:'second',error:null}));
 expect(result.current.loading).toBe(false);
 expect(result.current.data.updatedAt).toBe('second');
});
it('ignores results completing after the view closes',async()=>{let resolve!:(x:unknown)=>void;bridge.invoke.mockImplementation(()=>new Promise(r=>resolve=r));const {result,rerender}=renderHook(({enabled})=>useRecentResults(enabled),{initialProps:{enabled:true}});rerender({enabled:false});await act(async()=>resolve({matches:[],updatedAt:'late',error:null}));expect(result.current.data.updatedAt).toBeNull();});
it('shows loading while a slow initial request is pending and resolves a genuine empty response',async()=>{
 let resolve!:(x:unknown)=>void;bridge.invoke.mockImplementation(()=>new Promise(r=>resolve=r));
 const {result}=renderHook(()=>useRecentResults(true));expect(result.current.loading).toBe(true);
 await act(async()=>resolve({matches:[],updatedAt:'checked',error:null}));
 expect(result.current.loading).toBe(false);expect(result.current.data).toEqual({matches:[],updatedAt:'checked',error:null});
});
it('does not allow an old response to replace a newer response after reopening',async()=>{
 const requests:Array<(x:unknown)=>void>=[];bridge.invoke.mockImplementation(()=>new Promise(r=>requests.push(r)));
 const {result,rerender}=renderHook(({enabled})=>useRecentResults(enabled),{initialProps:{enabled:true}});
 rerender({enabled:false});rerender({enabled:true});
 await act(async()=>requests[1]({matches:[],updatedAt:'new',error:null}));
 await act(async()=>requests[0]({matches:[],updatedAt:'old',error:null}));
 expect(result.current.data.updatedAt).toBe('new');expect(result.current.loading).toBe(false);
});
it('reports loading after a competition switch until the new league results settle',async()=>{
 const requests:Array<(x:unknown)=>void>=[];
 bridge.invoke.mockImplementation(()=>new Promise(r=>requests.push(r)));
 const {result,rerender}=renderHook(({view})=>useRecentResults(true,view),{initialProps:{view:'premierLeague' as CompetitionView}});
 await act(async()=>requests[0]({matches:[],updatedAt:'pl',error:null}));
 expect(result.current.loading).toBe(false);
 rerender({view:'championsLeague' as CompetitionView});
 expect(result.current.loading).toBe(true);
 await waitFor(()=>expect(requests).toHaveLength(2));
 await act(async()=>requests[1]({matches:[],updatedAt:'ucl',error:null}));
 expect(result.current.loading).toBe(false);
 expect(result.current.data.updatedAt).toBe('ucl');
});
it('stops reporting pending after a competition request fails so the error is actionable',async()=>{
 const requests:Array<{resolve:(x:unknown)=>void;reject:(e:Error)=>void}>=[];
 bridge.invoke.mockImplementation(()=>new Promise((resolve,reject)=>requests.push({resolve,reject})));
 const {result,rerender}=renderHook(({view})=>useRecentResults(true,view),{initialProps:{view:'premierLeague' as CompetitionView}});
 await act(async()=>requests[0].resolve({matches:[],updatedAt:'pl',error:null}));
 rerender({view:'championsLeague' as CompetitionView});
 await act(async()=>requests[1].reject(new Error('offline')));
 expect(result.current.loading).toBe(false);
 expect(result.current.data.error).toBeTruthy();
});

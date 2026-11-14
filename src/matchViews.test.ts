import { expect,it } from 'vitest';
import { mergeResults, matchesView } from './matchViews';
import { mockSnapshot } from './test-fixtures/fixtures';
it('filters existing Premier League data without mutating or inventing fixtures',()=>{const m=mockSnapshot.matches;expect(matchesView(m,'All',[])).toEqual(m);expect(matchesView(m,'All',[],true)).toEqual([]);expect(matchesView(m,'Live',[]).every(m=>['live','halftime','suspended'].includes(m.status))).toBe(true);expect(matchesView(m,'Upcoming',[]).every(m=>m.status==='scheduled')).toBe(true);expect(matchesView(m,'Results',[]).every(m=>m.status==='fulltime')).toBe(true);});
it('selects the exact fixtures for each view and followed club',()=>{
 const matches=mockSnapshot.matches.slice(0,5);
 const ids=(view:Parameters<typeof matchesView>[1],favorites:string[]=[],followedOnly=false)=>matchesView(matches,view,favorites,followedOnly).map(m=>m.id);
 expect(ids('Live')).toEqual([matches[0].id,matches[1].id]);
 expect(ids('All',[matches[0].home.id],true)).toEqual([matches[0].id]);
 expect(ids('Upcoming')).toEqual([matches[2].id,matches[3].id]);
 expect(ids('Results')).toEqual([matches[4].id]);
 expect(ids('All')).toEqual(matches.map(m=>m.id));
});

it('lists a suspended game in the Live view, not in Upcoming or Results',()=>{
 const suspended={...mockSnapshot.matches[0],id:'suspended',status:'suspended' as const};
 expect(matchesView([suspended],'Live',[]).map(m=>m.id)).toEqual(['suspended']);
 expect(matchesView([suspended],'Upcoming',[])).toEqual([]);
 expect(matchesView([suspended],'Results',[])).toEqual([]);
});

it('keeps corrected history scores unless the daily fixture was confirmed more recently',()=>{
 const fixture={...mockSnapshot.matches[4],homeScore:1,scoreUpdatedAt:'2026-11-08T12:00:00Z'};
 const history={...fixture,homeScore:2,scoreUpdatedAt:'2026-11-08T13:00:00Z'};
 expect(mergeResults([history],[fixture])[0].homeScore).toBe(2);
 expect(mergeResults([history],[{...fixture,scoreUpdatedAt:'2026-11-08T14:00:00Z'}])[0].homeScore).toBe(1);
 expect(mergeResults([{...history,scoreUpdatedAt:null}],[{...fixture,scoreUpdatedAt:null}])[0].homeScore).toBe(2);
});

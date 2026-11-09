import { expect,it } from 'vitest';
import { mergeResults, matchesView } from './matchViews';
import { mockSnapshot } from './test-fixtures/fixtures';
it('filters existing Premier League data without mutating or inventing fixtures',()=>{const m=mockSnapshot.matches;expect(matchesView(m,'All',[])).toEqual(m);expect(matchesView(m,'Following',[])).toEqual([]);expect(matchesView(m,'Live',[]).every(m=>['live','halftime'].includes(m.status))).toBe(true);expect(matchesView(m,'Upcoming',[]).every(m=>m.status==='scheduled')).toBe(true);expect(matchesView(m,'Results',[]).every(m=>m.status==='fulltime')).toBe(true);});
it('selects the exact fixtures for each view and followed club',()=>{
 const matches=mockSnapshot.matches.slice(0,5);
 const ids=(view:Parameters<typeof matchesView>[1],favorites:string[]=[])=>matchesView(matches,view,favorites).map(m=>m.id);
 expect(ids('Live')).toEqual([matches[0].id,matches[1].id]);
 expect(ids('Following',[matches[0].home.id])).toEqual([matches[0].id]);
 expect(ids('Upcoming')).toEqual([matches[2].id,matches[3].id]);
 expect(ids('Results')).toEqual([matches[4].id]);
 expect(ids('All')).toEqual(matches.map(m=>m.id));
});

it('keeps corrected history scores unless the daily fixture was confirmed more recently',()=>{
 const fixture={...mockSnapshot.matches[4],homeScore:1,scoreUpdatedAt:'2026-11-08T12:00:00Z'};
 const history={...fixture,homeScore:2,scoreUpdatedAt:'2026-11-08T13:00:00Z'};
 expect(mergeResults([history],[fixture])[0].homeScore).toBe(2);
 expect(mergeResults([history],[{...fixture,scoreUpdatedAt:'2026-11-08T14:00:00Z'}])[0].homeScore).toBe(1);
 expect(mergeResults([{...history,scoreUpdatedAt:null}],[{...fixture,scoreUpdatedAt:null}])[0].homeScore).toBe(2);
});

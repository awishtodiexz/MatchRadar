import { expect,it } from 'vitest';
import { matchesView } from './matchViews';
import { mockSnapshot } from './test-fixtures/fixtures';
it('filters existing Premier League data without mutating or inventing fixtures',()=>{const m=mockSnapshot.matches;expect(matchesView(m,'All',[])).toEqual(m);expect(matchesView(m,'Following',[])).toEqual([]);expect(matchesView(m,'Live',[]).every(m=>['live','halftime'].includes(m.status))).toBe(true);expect(matchesView(m,'Upcoming',[]).every(m=>m.status==='scheduled')).toBe(true);expect(matchesView(m,'Results',[]).every(m=>m.status==='fulltime')).toBe(true);});

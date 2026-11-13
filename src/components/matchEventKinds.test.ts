import { expect,it } from 'vitest';
import { eventIconKey,eventLabel,eventTeamId,isIncident,keyEvent,varLabel } from './matchEventKinds';

it('keeps ESPN half-time, full-time and triple-hyphen VAR kinds in the key-event filter',()=>{
 for(const kind of ['kickoff','half-time','halftime','end-regular-time','full-time','start-2nd-half']) expect(keyEvent(kind)).toBe(true);
 expect(keyEvent('foul')).toBe(false);expect(keyEvent('shot-off-target')).toBe(false);
 expect(isIncident('var---referee-decision-cancelled')).toBe(true);
 expect(isIncident('var-goal-awarded')).toBe(true);
 expect(isIncident('kickoff')).toBe(false);
});
it('gives provider-specific markers and VAR reviews readable labels',()=>{
 expect(eventLabel('halftime')).toBe('Half-time');
 expect(eventLabel('end-regular-time')).toBe('Full-time');
 expect(eventLabel('start-2nd-half')).toBe('Second half');
 expect(eventLabel('goal---header')).toBe('Header goal');
 expect(eventLabel('var---referee-decision-cancelled')).toBe('VAR review · Referee decision cancelled');
 expect(eventLabel('var---goal-cancelled')).toBe('VAR review · Goal cancelled');
});

it('maps each kind of commentary to its own icon',()=>{
 const expected:Record<string,string>={
  goal:'goal','goal---header':'goal','penalty---scored':'goal','own-goal':'goal','penalty---missed':'penalty-miss',
  'yellow-card':'card-yellow','red-card':'card-red','second-yellow-card':'card-red',substitution:'substitution',
  'var-decision':'var','var---goal-cancelled':'var',kickoff:'kickoff','start-2nd-half':'kickoff',halftime:'half-time','half-time':'half-time',
  'end-regular-time':'full-time','full-time':'full-time','start-delay':'delay','end-delay':'delay',corner:'corner',offside:'offside',foul:'foul',
  'shot-on-target':'shot-on','shot-off-target':'shot-off','shot-blocked':'shot-blocked','attempt-saved':'save','pre-match':'pre-match',commentary:'commentary',
 };
 for(const [kind,key] of Object.entries(expected)) expect([kind,eventIconKey(kind)]).toEqual([kind,key]);
 expect(new Set(Object.values(expected)).size).toBeGreaterThanOrEqual(18);
});
it('attributes a foul to the side that committed it whichever way ESPN words the text or tags the team',()=>{
 const home={id:'1',name:'Manchester City',short:'MAN'},away={id:'2',name:'Chelsea',short:'CHE'};
 const foul=(text:string,teamId:string|null)=>({kind:'foul',text,teamId});
 // "wins a free kick" names the fouled side; the team tag is the committer.
 expect(eventTeamId(foul('Levi Colwill (Chelsea) wins a free kick in the defensive half.','1'),home,away)).toBe('1');
 // If the tag is the fouled side instead, the prose corrects it.
 expect(eventTeamId(foul('Levi Colwill (Chelsea) wins a free kick in the defensive half.','2'),home,away)).toBe('1');
 expect(eventTeamId(foul('Foul by Rodri (Manchester City).','2'),home,away)).toBe('1');
 expect(eventTeamId(foul('Foul by Rodri (Manchester City).','1'),home,away)).toBe('1');
 expect(eventTeamId(foul('A foul.','2'),home,away)).toBe('2');
 expect(eventTeamId({kind:'corner',text:'Corner, Chelsea (Chelsea).',teamId:'1'},home,away)).toBe('1');
});
it('gives VAR rows a readable headline',()=>{
 expect(varLabel('var-decision','VAR Decision: Goal disallowed Matheus Cunha (Wolves).')).toBe('VAR · Goal disallowed');
 expect(varLabel('var---referee-decision-cancelled','VAR Decision: Card upgraded Igor Thiago.')).toBe('VAR · Card upgraded');
 expect(varLabel('var---goal-cancelled','')).toBe('VAR · Goal cancelled');
 expect(varLabel('var-decision','VAR review in progress.')).toBe('VAR review');
 expect(varLabel('var','')).toBe('VAR review');
});

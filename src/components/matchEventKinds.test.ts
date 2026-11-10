import { expect,it } from 'vitest';
import { eventLabel,isIncident,keyEvent } from './matchEventKinds';

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

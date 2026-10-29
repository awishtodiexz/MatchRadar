import { describe, expect, it } from 'vitest';
import { updateStatus } from './freshness';
import { mockSnapshot } from './demo/fixtures';

describe('independent source freshness', () => {
  it('does not label a fixture-only success as a fresh scoreboard', () => {
    expect(updateStatus({...mockSnapshot,partial:true,error:'Scores failed',scoreError:'HTTP 500',updatedAt:'old scores',fixtureUpdatedAt:'new fixtures'}))
      .toEqual({label:'PARTIAL · SCORES SAVED',timestamp:'old scores'});
    expect(updateStatus({...mockSnapshot,partial:true,error:'Scores failed',scoreError:'HTTP 500',updatedAt:null,fixtureUpdatedAt:'new fixtures'}))
      .toEqual({label:'PARTIAL · FIXTURES UPDATED',timestamp:'new fixtures'});
    expect(updateStatus({...mockSnapshot,partial:true,error:'Partial month and failed scores',updatedAt:null,fixtureUpdatedAt:null}))
      .toEqual({label:'PARTIAL · DATA SAVED',timestamp:null});
  });
  it('shows valid scores with a fixture error, or a complete failure without a false success time', () => {
    expect(updateStatus({...mockSnapshot,partial:true,error:'Fixtures failed',fixtureError:'HTTP 500',updatedAt:'new scores'}))
      .toEqual({label:'PARTIAL · SCORES CHECKED',timestamp:'new scores'});
    expect(updateStatus({...mockSnapshot,partial:false,error:'Both failed',scoreError:'HTTP 500',updatedAt:'old scores'}))
      .toEqual({label:'UPDATE FAILED · SCORES SAVED',timestamp:'old scores'});
  });
  it('keeps ordinary success, loading and empty startup distinguishable', () => {
    expect(updateStatus({...mockSnapshot,updatedAt:'checked'})).toEqual({label:'SCORES CHECKED',timestamp:'checked'});
    expect(updateStatus({...mockSnapshot,refreshing:true})).toEqual({label:'UPDATING'});
    expect(updateStatus(null)).toEqual({label:'CONNECTING'});
  });
});

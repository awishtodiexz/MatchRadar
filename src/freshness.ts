import type { Snapshot } from './types';

export function updateStatus(snapshot: Snapshot | null): {label: string; timestamp?: string | null} {
  if (snapshot?.refreshing) return {label:'UPDATING'};
  if (snapshot?.error) return {
    label:(snapshot.partial ? 'PARTIAL' : 'UPDATE FAILED')+' · '+(snapshot.updatedAt ? (snapshot.scoreError?'SCORES SAVED':'SCORES CHECKED') : snapshot.fixtureUpdatedAt?'FIXTURES UPDATED':snapshot.matches.length?'DATA SAVED':'NO CACHE'),
    timestamp:snapshot.updatedAt ?? snapshot.fixtureUpdatedAt
  };
  if (snapshot?.updatedAt) return {label:'SCORES CHECKED',timestamp:snapshot.updatedAt};
  if (snapshot?.fixtureUpdatedAt) return {label:'FIXTURES UPDATED',timestamp:snapshot.fixtureUpdatedAt};
  return {label:'CONNECTING'};
}

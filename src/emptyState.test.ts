import { expect,it } from 'vitest';
import { liveEmptyState } from './emptyState';

const base={scoreError:false,savedLive:false,live:0,followedOnly:false,view:'Live' as const};
it('distinguishes confirmed quiet, filtered, unavailable and unconfirmed live states',()=>{
  expect(liveEmptyState(base)?.title).toBe('No Premier League matches are live right now');
  expect(liveEmptyState({...base,live:1,followedOnly:true})).toMatchObject({title:'No followed clubs are live',canShowAll:true});
  expect(liveEmptyState({...base,scoreError:true})?.title).toBe('Live status unavailable');
  expect(liveEmptyState({...base,scoreError:true,followedOnly:true,live:1})?.title).toBe('Live status unavailable');
  expect(liveEmptyState({...base,scoreError:true,savedLive:true})?.title).toBe('Live scores awaiting confirmation');
  expect(liveEmptyState({...base,view:'All'})).toBeNull();
});

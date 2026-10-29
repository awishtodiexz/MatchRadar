import { useEffect, useState } from 'react';

// One local-midnight timer, reconciled when returning from sleep/background. No feed requests.
export function useLocalDay() {
  const [day, setDay] = useState(()=>new Date());
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const reconcile = () => {
      const now = new Date();
      setDay(now);
      const midnight = new Date(now); midnight.setHours(24,0,0,0);
      clearTimeout(timer);
      timer = setTimeout(reconcile, midnight.getTime()-now.getTime()+50);
    };
    reconcile();
    const visible = () => { if(document.visibilityState==='visible') reconcile(); };
    window.addEventListener('focus',reconcile);
    document.addEventListener('visibilitychange',visible);
    return ()=>{clearTimeout(timer);window.removeEventListener('focus',reconcile);document.removeEventListener('visibilitychange',visible);};
  },[]);
  return day;
}

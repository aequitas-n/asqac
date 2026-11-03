import { useEffect, useState } from 'react';
export function useClock(period = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const resume = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), period);
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [period]);
  return now;
}

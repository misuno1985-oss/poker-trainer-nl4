import { useEffect, useState } from 'react';

/** True on phone-sized viewports, where the seat ring has to be tighter. */
export function useNarrow(query = '(max-width: 900px)'): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

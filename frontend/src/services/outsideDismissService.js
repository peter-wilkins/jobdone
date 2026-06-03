import { useEffect } from 'react';

export function useOutsideDismiss(active, refs, onDismiss) {
  useEffect(() => {
    if (!active) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      const isInside = refs.some(ref => ref.current && ref.current.contains(target));
      if (!isInside) onDismiss();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, refs, onDismiss]);
}

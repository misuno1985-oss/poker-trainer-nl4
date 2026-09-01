import { useEffect, useRef, useState } from 'react';

/**
 * Ширина стола, при которой он целиком помещается в свою ячейку.
 *
 * Казалось бы, это делается одним `width: min(920px, 100cqw, 160cqh)` — и это
 * даже работает, пока ячейка не меняет высоту. Но именно это и происходит:
 * когда открывается панель размера ставки, нижняя зона выше, а ячейка стола
 * ниже. В Chrome ширина после такого пересчёта застревала на старом значении:
 * контейнерные единицы в собственной ширине элемента брали размер контейнера с
 * прошлой раскладки, и стол снова наезжал на место героя.
 *
 * Поэтому размер считается замером. Наблюдаем РОДИТЕЛЯ, а не сам стол: высота
 * ячейки задана сеткой и от содержимого не зависит, поэтому обратной связи
 * «стол вырос → ячейка выросла → стол вырос» здесь нет.
 */
export function useTableFit(
  aspect: number,
  maxWidth: number,
  enabled: boolean,
): [React.RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setWidth(null);
      return;
    }
    const box = ref.current?.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const cs = getComputedStyle(box);
      const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const fit = Math.min(maxWidth, w, h * aspect);
      // Округление до целого пикселя, иначе дробные значения дают лишние
      // перерисовки на каждом кадре анимации соседних блоков.
      setWidth(Math.max(0, Math.round(fit)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [aspect, maxWidth, enabled]);

  return [ref, enabled ? width : null];
}

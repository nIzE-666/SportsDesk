import { useEffect, useRef } from 'react';

const COLORS = ['#fde68a', '#fef3c7', '#ffffff', '#facc15', '#fcd34d'];
const DURATION_MS = 2600;

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

/**
 * Брызги шампанского: два фонтана вверх и в стороны от центра. Как у конфетти,
 * шаг по времени ограничен и в скрытом окне анимация стоит, поэтому после
 * сворачивания нет скачка накопленного времени.
 */
export function Champagne({ count = 70 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = (canvas.width = window.innerWidth);
    const height = (canvas.height = window.innerHeight);
    const drops: Drop[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const angle = ((side * (18 + Math.random() * 38) - 90) * Math.PI) / 180;
        const speed = 520 + Math.random() * 520;
        drops.push({
          x: width / 2 + side * Math.min(190, width * 0.18),
          y: height * 0.52,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 1.6 + Math.random() * 2.6,
          color: COLORS[(i + (side > 0 ? 2 : 0)) % COLORS.length] ?? '#ffffff',
        });
      }
    }
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const frame = (time: number) => {
      const dt = Math.min(0.05, Math.max(0, (time - last) / 1000));
      last = time;
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      elapsed += dt * 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(
        0,
        1 - Math.max(0, elapsed - DURATION_MS * 0.55) / (DURATION_MS * 0.45),
      );
      for (const drop of drops) {
        drop.vy += 1500 * dt;
        drop.vx *= 1 - 0.5 * dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
        ctx.fillStyle = drop.color;
        ctx.fill();
      }
      if (elapsed < DURATION_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, width, height);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}

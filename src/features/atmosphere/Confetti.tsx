import { useEffect, useRef } from 'react';

const COLORS = ['#22c55e', '#facc15', '#f8fafc', '#38bdf8', '#f97316'];
const DURATION_MS = 2600;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
}

/**
 * Короткий залп конфетти на canvas. Время шага ограничено, а в скрытом окне
 * анимация не идёт, поэтому после сворачивания нет скачка накопленного времени.
 */
export function Confetti({ colors = COLORS, count = 140 }: { colors?: string[]; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = (canvas.width = window.innerWidth);
    const height = (canvas.height = window.innerHeight);
    const parts: Particle[] = Array.from({ length: count }, (_, i) => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.3,
      vx: (Math.random() - 0.5) * 900,
      vy: -300 - Math.random() * 700,
      size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      color: colors[i % colors.length] ?? '#ffffff',
    }));
    let raf = 0,
      last = performance.now(),
      elapsed = 0;
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
        1 - Math.max(0, elapsed - DURATION_MS * 0.6) / (DURATION_MS * 0.4),
      );
      for (const p of parts) {
        p.vy += 1400 * dt;
        p.vx *= 1 - 0.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        ctx.restore();
      }
      if (elapsed < DURATION_MS) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, width, height);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [colors, count]);
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}

import { useEffect, useRef } from 'react';

/**
 * Slow translucent sea lines with a little drifting mist, drawn on one canvas.
 * Kept light on purpose: pixel ratio capped, ~30 fps-equivalent work per frame, and the loop stops while
 * the canvas is off screen, the tab is hidden, or the visitor prefers reduced motion (one still frame).
 */
const LINES = 9;
const MOTES = 36;

export default function WaveCanvas({ className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    const motes = Array.from({ length: MOTES }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.6,
      vx: 0.00004 + Math.random() * 0.00008,
      vy: -0.00002 - Math.random() * 0.00004,
      a: 0.08 + Math.random() * 0.22,
    }));

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      mouse.x += (mouse.tx - mouse.x) * 0.03;
      mouse.y += (mouse.ty - mouse.y) * 0.03;
      const time = t * 0.00012;
      const step = Math.max(10, w / 90);

      for (let i = 0; i < LINES; i += 1) {
        const p = i / (LINES - 1);
        const baseY = h * (0.42 + p * 0.5);
        const amp = h * (0.018 + p * 0.03);
        // Lines near the pointer lift a touch, like a breeze over water.
        const lift = (mouse.y - 0.5) * h * 0.04 * (1 - p);
        ctx.beginPath();
        for (let x = -step; x <= w + step; x += step) {
          const nx = x / w;
          const pull = Math.exp(-((nx - mouse.x) ** 2) * 8) * h * 0.025 * (1 - p * 0.6);
          const y =
            baseY +
            lift -
            pull +
            Math.sin(nx * 5.2 + time * (1.4 + p) + i * 0.7) * amp +
            Math.sin(nx * 11.5 - time * 2.1 + i * 1.9) * amp * 0.35;
          if (x === -step) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const gold = i % 3 === 0;
        ctx.strokeStyle = gold ? `rgba(197,168,128,${0.1 + p * 0.16})` : `rgba(122,154,149,${0.08 + p * 0.14})`;
        ctx.lineWidth = gold ? 1.2 : 1;
        ctx.stroke();
      }

      for (const m of motes) {
        m.x += m.vx * (reduce ? 0 : 16);
        m.y += m.vy * (reduce ? 0 : 16);
        if (m.x > 1.02) m.x = -0.02;
        if (m.y < -0.02) m.y = 1.02;
        ctx.beginPath();
        ctx.fillStyle = `rgba(247,244,239,${m.a})`;
        ctx.arc(m.x * w, m.y * h, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(t) {
      draw(t);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    }
    const start = () => {
      if (!raf && visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop);
    };

    resize();
    draw(0);
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce || !raf) draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    io.observe(canvas);
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - rect.left) / rect.width;
      mouse.ty = (e.clientY - rect.top) / rect.height;
    };
    const onVis = () => start();
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

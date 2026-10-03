"use client";

import { useEffect, useRef } from "react";

/**
 * A burst of confetti over the page, once. Brand colours, ~2.5 seconds, then
 * it clears itself away. Nothing at all for anyone whose device asks for
 * reduced motion.
 */
export function ConfettiBurst() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const colors = ["#ea580c", "#facc15", "#10b981", "#38bdf8", "#ec4899", "#8b5cf6"];
    const w = () => canvas.width;
    const h = () => canvas.height;
    // Two cannons from the bottom corners, aimed up and in.
    const pieces = Array.from({ length: 160 }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = (14 + Math.random() * 10) * dpr;
      return {
        x: left ? 0 : w(),
        y: h() * 0.9,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (6 + Math.random() * 6) * dpr,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        wobble: Math.random() * 10,
      };
    });

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, w(), h());
      for (const p of pieces) {
        p.vy += 0.35 * dpr;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx + Math.sin((frame + p.wobble) / 8) * dpr;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - frame / 170);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 + Math.abs(Math.cos(p.rot)) * p.size / 2);
        ctx.restore();
      }
      if (frame < 170) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w(), h());
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-testid="confetti"
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}

/** A soccer ball that bounces in and settles. Still for reduced motion. */
export function BouncingBall({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`cs-bounce inline-block select-none ${className}`}>
      ⚽
      <style>{`
        @keyframes cs-bounce-in {
          0% { transform: translateY(-120%) rotate(-90deg); opacity: 0; }
          45% { transform: translateY(0) rotate(0deg); opacity: 1; }
          62% { transform: translateY(-28%) rotate(40deg); }
          78% { transform: translateY(0) rotate(60deg); }
          88% { transform: translateY(-8%) rotate(70deg); }
          100% { transform: translateY(0) rotate(72deg); }
        }
        .cs-bounce { animation: cs-bounce-in 1.3s cubic-bezier(.3,.7,.4,1) both; }
        @media (prefers-reduced-motion: reduce) { .cs-bounce { animation: none; } }
      `}</style>
    </span>
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Pointer-only depth: no scroll interception or per-frame React renders. */
export function PointerScene({ children, className = "", enabled = true, strength = 7 }: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  strength?: number;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  useEffect(() => {
    const el = scene.current, layer = surface.current;
    if (!el || !layer) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)");
    let current = { x: 0, y: 0 };

    const render = () => {
      frame.current = 0;
      if (!enabled || reduced.matches || coarse.matches) {
        current = { x: 0, y: 0 };
        layer.style.transform = "";
        return;
      }
      current = {
        x: current.x + (target.current.x - current.x) * .16,
        y: current.y + (target.current.y - current.y) * .16,
      };
      if (Math.abs(target.current.x - current.x) < .002 && Math.abs(target.current.y - current.y) < .002) {
        current = { ...target.current };
        if (current.x === 0 && current.y === 0) { layer.style.transform = ""; return; }
      }
      const rx = -current.y * strength, ry = current.x * strength;
      layer.style.transform = `translate3d(${(current.x * strength * .9).toFixed(3)}px, ${(current.y * strength * .7).toFixed(3)}px, 0) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
      if (current.x !== target.current.x || current.y !== target.current.y) frame.current = requestAnimationFrame(render);
    };
    const queue = () => { if (!frame.current) frame.current = requestAnimationFrame(render); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      target.current = {
        x: Math.max(-1, Math.min(1, (event.clientX - r.left) / r.width * 2 - 1)),
        y: Math.max(-1, Math.min(1, (event.clientY - r.top) / r.height * 2 - 1)),
      };
      queue();
    };
    const reset = () => { target.current = { x: 0, y: 0 }; queue(); };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    el.addEventListener("pointercancel", reset);
    reduced.addEventListener("change", queue);
    coarse.addEventListener("change", queue);
    queue();
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      el.removeEventListener("pointercancel", reset);
      reduced.removeEventListener("change", queue);
      coarse.removeEventListener("change", queue);
      layer.style.transform = "";
    };
  }, [enabled, strength]);

  return <div ref={scene} className={`pointer-scene ${className}`}><div ref={surface} className="pointer-surface">{children}</div></div>;
}

import { useEffect, useRef, type ReactNode } from "react";
import type { Async } from "./hooks";

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const cls = tier === "–" ? "na" : tier.replace("+", "p").toLowerCase();
  return <span className={`tier tier-${cls}`}>{tier}</span>;
}

export function Swatch({ hex }: { hex: string }) {
  return <span className="swatch" style={{ background: hex }} />;
}

export function SeatBadge({ n }: { n: number }) {
  return <span className="seat">{n}</span>;
}

export function Card({ title, sub, children }: { title?: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {sub && <p className="muted">{sub}</p>}
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <section className="card empty">{children}</section>;

/** Renders loading / error states, or `children(data)` once ready. */
export function Loaded<T>({ state, children }: { state: Async<T>; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <p className="muted">Loading…</p>;
  if (state.status === "error") return <Empty>Couldn't load data: {state.error.message}</Empty>;
  return <>{children(state.data)}</>;
}

/**
 * Win-rate bar diverging around the expected rate (the neutral midline).
 * Blue = above expected, red = below. The number beside it carries the value,
 * so color is never the only signal.
 */
export function DeltaBar({ delta, range = 0.1 }: { delta: number; range?: number }) {
  const w = Math.min(50, (Math.abs(delta) / range) * 50);
  const style = delta >= 0 ? { left: "50%", width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` };
  return (
    <span className="dbar" aria-hidden="true">
      <span className="dbar-mid" />
      <span className={`dbar-fill ${delta >= 0 ? "pos" : "neg"}`} style={style} />
    </span>
  );
}

/** Single-series vertical bar chart (inline SVG) with per-bar hover tooltips. */
export function BarChart({ bins, height = 180, label }: { bins: { label: string; value: number; tip: string }[]; height?: number; label: string }) {
  const H = height, W = 640, padL = 36, padB = 22, padT = 8, r = 4;
  const max = Math.max(1, ...bins.map((b) => b.value));
  const step = (W - padL) / Math.max(1, bins.length);
  const bw = Math.max(2, step - 2); // 2px surface gap between bars
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const base = H - padB;
  const labelEvery = Math.ceil(bins.length / 10);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => {
        const t = Math.round(max * f);
        return (
          <g key={f}>
            <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        );
      })}
      {bins.map((b, i) => {
        const x = padL + i * step + 1;
        const top = y(b.value), h = base - top;
        const rr = Math.min(r, h, bw / 2);
        // Rounded data-end (top), square at the baseline.
        const d = h <= 0 ? "" :
          `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${base}Z`;
        return (
          <g key={i} className="bar" data-tip={b.tip}>
            <rect className="hit" x={x - 1} y={padT} width={step} height={H - padT - padB} />
            <path d={d} />
          </g>
        );
      })}
      {bins.map((b, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={padL + i * step + step / 2} y={H - 6} textAnchor="middle">{b.label}</text>
        ) : null,
      )}
    </svg>
  );
}

/** One shared tooltip, driven by [data-tip] attributes anywhere in the page. */
export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (!el) {
        tip.style.opacity = "0";
        return;
      }
      tip.textContent = el.getAttribute("data-tip");
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.transform = `translate(${x}px, ${e.clientY + 14}px)`;
      tip.style.opacity = "1";
    };
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, []);
  return <div ref={ref} className="tooltip" role="tooltip" />;
}

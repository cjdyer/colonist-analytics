export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const signedPp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
export const int = (n: number) => Math.round(n).toLocaleString();
export const fixed = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "–");

export function duration(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function ago(unixSec: number): string {
  const s = Date.now() / 1000 - unixSec;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export const playerPath = (name: string) => `/player/${encodeURIComponent(name)}`;

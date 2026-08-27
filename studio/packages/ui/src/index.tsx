import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./styles.css";

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "close"
  | "code"
  | "download"
  | "edit"
  | "eye"
  | "file"
  | "grid"
  | "image"
  | "layers"
  | "more"
  | "play"
  | "plus"
  | "spark"
  | "text"
  | "warning";

const paths: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  close: <><path d="m7 7 10 10"/><path d="M17 7 7 17"/></>,
  code: <><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/></>,
  download: <><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/></>,
  edit: <><path d="m14 5 5 5L9 20H4v-5Z"/><path d="m12 7 5 5"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  file: <><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4"/></>,
  grid: <><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 4"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  spark: <><path d="m12 2 1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7Z"/></>,
  text: <><path d="M5 5h14"/><path d="M12 5v14"/><path d="M8 19h8"/></>,
  warning: <><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "quiet" | "outline" | "danger";
  size?: "sm" | "md";
};

export function Button({ tone = "quiet", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`od-button od-button--${tone} od-button--${size} ${className}`} {...props} />;
}

export function Kicker({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`od-kicker ${className}`} {...props}>{children}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "accent" }) {
  return <span className={`od-badge od-badge--${tone}`}>{children}</span>;
}

export function Tabs<T extends string>({ value, items, onChange, label }: { value: T; items: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void; label: string }) {
  return <div className="od-tabs" role="tablist" aria-label={label}>{items.map((item) => <button key={item.value} type="button" role="tab" aria-selected={value === item.value} className={value === item.value ? "is-active" : ""} onClick={() => onChange(item.value)}><span>{item.label}</span>{item.count !== undefined && <span className="od-tabs__count">{item.count}</span>}</button>)}</div>;
}

export function ProgressRing({ value, size = 38 }: { value: number; size?: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  return <div className="od-ring" style={{ width: size, height: size }}><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r={radius}/><circle className="od-ring__value" cx="20" cy="20" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)}/></svg><span>{value}</span></div>;
}

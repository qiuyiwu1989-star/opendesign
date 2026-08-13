import { useState, type ReactNode } from "react";
import type { DataSourceState } from "../domain";

export type Screen = "today" | "quality" | "review" | "assets" | "pipelines" | "sync";
export type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

const iconPaths: Record<string, ReactNode> = {
  today: <><path d="M4 5.5h16M6.5 3v5M17.5 3v5M5 9.5h14v10H5z"/><path d="m8 14 2 2 5-5"/></>,
  review: <><path d="M7 4h10M7 20h10M5 7h14v10H5z"/><path d="m9 12 2 2 4-4"/></>,
  quality: <><path d="M12 3 4.5 6v5.5c0 4.6 3 7.7 7.5 9.5 4.5-1.8 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  assets: <><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></>,
  pipelines: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h3a4 4 0 0 1 4 4M8 18h3a4 4 0 0 0 4-4"/></>,
  sync: <><path d="M20 7h-7a4 4 0 0 0-4 4v1M4 17h7a4 4 0 0 0 4-4v-1"/><path d="m17 4 3 3-3 3M7 14l-3 3 3 3"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  command: <><path d="M9 6H7a3 3 0 1 0 3 3V4M15 6h2a3 3 0 1 1-3 3V4M9 18H7a3 3 0 1 1 3-3v5M15 18h2a3 3 0 1 0-3-3v8"/></>,
  arrow: <><path d="M5 12h14M15 8l4 4-4 4"/></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
  panel: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M14 4v16"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  external: <path d="M14 5h5v5M19 5l-8 8M18 13v6H5V6h6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
};

export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function SourceNotice({ source, generatedAt }: { source: DataSourceState; generatedAt?: string }) {
  const tone: Tone = source === "live" ? "good" : source === "snapshot" ? "warn" : "bad";
  const label = source === "live" ? "实时数据" : source === "snapshot" ? "只读快照" : "数据不可用";
  return <div className="source-notice" role="status"><span className={`signal signal--${tone}`} /> <strong>{label}</strong>{generatedAt && <time dateTime={generatedAt}>{formatTime(generatedAt)}</time>}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Icon name="info" size={22}/><strong>{title}</strong><p>{detail}</p></div>;
}

export function LoadingState() {
  return <div className="loading-state" role="status" aria-live="polite"><span/><span/><span/><p>正在整理控制室快照…</p></div>;
}

export function formatTime(value?: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

const nav: { id: Screen; label: string; caption: string }[] = [
  { id: "today", label: "Today", caption: "现在最值得做的事" },
  { id: "quality", label: "质量决策", caption: "AI 建议与人工复核" },
  { id: "review", label: "统一审核", caption: "四种来源，一个队列" },
  { id: "assets", label: "设计资源", caption: "证据、策展、源站" },
  { id: "pipelines", label: "管线运行", caption: "检查点与失败定位" },
  { id: "sync", label: "GitHub Sync", caption: "五层漂移视图" },
];

export function Shell({ screen, onScreen, source, generatedAt, counts, sessionControl, reviewEnabled = false, children }: { screen: Screen; onScreen: (screen: Screen) => void; source: DataSourceState; generatedAt?: string; counts: Partial<Record<Screen, number>>; sessionControl?: ReactNode; reviewEnabled?: boolean; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectScreen = (next: Screen) => { onScreen(next); setMobileNavOpen(false); };
  return <div className="control-room">
    <header className="masthead">
      <button className="mobile-menu" type="button" aria-label={mobileNavOpen ? "关闭工作区导航" : "打开工作区导航"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}><Icon name={mobileNavOpen ? "close" : "menu"}/></button>
      <div className="brand"><span className="brand-mark"><i/><i/><i/></span><span><strong>OpenDesign</strong><small>Control Room</small></span></div>
      <div className="masthead-center"><SourceNotice source={source} {...(generatedAt ? { generatedAt } : {})}/></div>
      <div className="masthead-actions"><button type="button" className="command" onClick={() => selectScreen("assets")}><Icon name="search"/> 全局搜索 <kbd>⌘ K</kbd></button>{sessionControl}<Pill tone={reviewEnabled ? "good" : "accent"}>{reviewEnabled ? "HUMAN REVIEW" : "PREVIEW ONLY"}</Pill></div>
    </header>
    <aside className={`sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} aria-label="控制室工作区">
      <div className="sidebar-intro"><small>DESIGN INTELLIGENCE</small><p>让每次收录与拒绝都有证据、策略版本和可审查记录。</p></div>
      <nav>{nav.map(item => <button key={item.id} type="button" className={screen === item.id ? "is-current" : ""} onClick={() => selectScreen(item.id)} aria-current={screen === item.id ? "page" : undefined}><Icon name={item.id}/><span><strong>{item.label}</strong><small>{item.caption}</small></span>{counts[item.id] !== undefined && <i>{counts[item.id]}</i>}</button>)}</nav>
      <div className="sidebar-policy"><Icon name="info"/><span><strong>最终决定在人</strong><small>AI 提供建议；垃圾和广告优先隔离，人工确认后才写回。</small></span></div>
    </aside>
    <main>{children}</main>
  </div>;
}

export function PageHeader({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: ReactNode }) {
  return <header className="page-header"><div><small className="eyebrow">{eyebrow}</small><h1>{title}</h1><p>{description}</p></div>{aside}</header>;
}

export function PreviewDrawer({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: ReactNode }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="preview-drawer" role="dialog" aria-modal="true" aria-label={`${title} 预览`} onClick={event => event.stopPropagation()}><header><div><small className="eyebrow">{kicker}</small><h2>{title}</h2></div><button type="button" aria-label="关闭预览" onClick={onClose}><Icon name="close"/></button></header>{children}<footer><Pill tone="accent">只读预览</Pill><span>任何判断都不会在本阶段写回。</span></footer></aside></div>;
}

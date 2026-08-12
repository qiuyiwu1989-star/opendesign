import { useEffect, useState } from "react";
import type { AdminSnapshot } from "./domain";
import { ADMIN_LOGIN_ENDPOINT, loadAdminSession, loadAdminSnapshot, logoutAdminSession, type AdminSessionState } from "./data";
import { AssetsScreen, PipelinesScreen, ReviewScreen, SyncScreen, TodayScreen } from "./components/screens";
import { EmptyState, LoadingState, PreviewDrawer, Shell, type Screen } from "./components/system";

export interface AppProps { initialSnapshot?: AdminSnapshot; initialSession?: AdminSessionState }

export function App({ initialSnapshot, initialSession }: AppProps) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | undefined>(initialSnapshot);
  const [loadError, setLoadError] = useState("");
  const [screen, setScreen] = useState<Screen>("today");
  const [preview, setPreview] = useState<{ title: string; detail: string }>();
  const [session, setSession] = useState<AdminSessionState>(initialSession ?? (initialSnapshot ? { kind: "unavailable" } : { kind: "loading" }));

  useEffect(() => {
    if (initialSnapshot) return;
    let active = true;
    loadAdminSnapshot().then(value => { if (active) setSnapshot(value); }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : "无法加载管理快照");
    });
    return () => { active = false; };
  }, [initialSnapshot]);

  useEffect(() => {
    if (initialSession || initialSnapshot) return;
    let active = true;
    void loadAdminSession().then(value => { if (active) setSession(value); });
    return () => { active = false; };
  }, [initialSession, initialSnapshot]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setScreen("assets");
      }
      if (event.key === "Escape") setPreview(undefined);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snapshot && !loadError) return <LoadingState/>;
  if (!snapshot) return <div className="fatal-state"><EmptyState title="控制室快照不可用" detail={`${loadError}。没有把示例数据伪装成生产状态。`}/></div>;

  const counts = {
    review: snapshot.reviews.filter(item => item.status === "pending").length,
    assets: snapshot.assets.length,
    pipelines: snapshot.pipelines.filter(item => item.status === "failed").length,
  };
  const openPreview = (title: string, detail: string) => setPreview({ title, detail });

  const sessionControl = session.kind === "authenticated"
    ? <button type="button" className="session-control" onClick={() => { void logoutAdminSession().then(ok => { if (ok) setSession({ kind: "unauthenticated" }); }); }} aria-label={`退出 GitHub 账号 ${session.actor.login}`}><span className="signal signal--good"/>{session.actor.login} · 退出</button>
    : session.kind === "unauthenticated"
      ? <a className="session-control session-control--login" href={ADMIN_LOGIN_ENDPOINT}>使用 GitHub 登录</a>
      : session.kind === "unavailable"
        ? <span className="session-control session-control--muted">登录服务不可用</span>
        : <span className="session-control session-control--muted">检查登录状态…</span>;

  return <Shell screen={screen} onScreen={setScreen} source={snapshot.source.kind} generatedAt={snapshot.generatedAt} counts={counts} sessionControl={sessionControl}>
    {screen === "today" && <TodayScreen today={snapshot.today} reviews={snapshot.reviews} pipelines={snapshot.pipelines} sync={snapshot.sync} onNavigate={setScreen} onPreview={openPreview}/>} 
    {screen === "review" && <ReviewScreen reviews={snapshot.reviews} assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "assets" && <AssetsScreen assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "pipelines" && <PipelinesScreen pipelines={snapshot.pipelines} onPreview={openPreview}/>} 
    {screen === "sync" && <SyncScreen sync={snapshot.sync} diagnostics={snapshot.diagnostics} onPreview={openPreview}/>} 
    {preview && <PreviewDrawer title={preview.title} kicker="PREVIEW · NO WRITE" onClose={() => setPreview(undefined)}><div className="drawer-section preview-copy"><p>{preview.detail}</p><div className="preview-diff"><span>当前快照</span><i/><span>建议状态</span></div><small>变更确认、审计记录和写回能力不在当前只读阶段范围内。</small></div></PreviewDrawer>}
  </Shell>;
}

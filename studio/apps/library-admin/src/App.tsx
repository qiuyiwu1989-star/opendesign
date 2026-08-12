import { useEffect, useState } from "react";
import type { AdminSnapshot } from "./domain";
import { loadAdminSnapshot } from "./data";
import { AssetsScreen, PipelinesScreen, ReviewScreen, SyncScreen, TodayScreen } from "./components/screens";
import { EmptyState, LoadingState, PreviewDrawer, Shell, type Screen } from "./components/system";

export interface AppProps { initialSnapshot?: AdminSnapshot }

export function App({ initialSnapshot }: AppProps) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | undefined>(initialSnapshot);
  const [loadError, setLoadError] = useState("");
  const [screen, setScreen] = useState<Screen>("today");
  const [preview, setPreview] = useState<{ title: string; detail: string }>();

  useEffect(() => {
    if (initialSnapshot) return;
    let active = true;
    loadAdminSnapshot().then(value => { if (active) setSnapshot(value); }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : "无法加载管理快照");
    });
    return () => { active = false; };
  }, [initialSnapshot]);

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

  return <Shell screen={screen} onScreen={setScreen} source={snapshot.source.kind} generatedAt={snapshot.generatedAt} counts={counts}>
    {screen === "today" && <TodayScreen today={snapshot.today} reviews={snapshot.reviews} pipelines={snapshot.pipelines} sync={snapshot.sync} onNavigate={setScreen} onPreview={openPreview}/>} 
    {screen === "review" && <ReviewScreen reviews={snapshot.reviews} assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "assets" && <AssetsScreen assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "pipelines" && <PipelinesScreen pipelines={snapshot.pipelines} onPreview={openPreview}/>} 
    {screen === "sync" && <SyncScreen sync={snapshot.sync} diagnostics={snapshot.diagnostics} onPreview={openPreview}/>} 
    {preview && <PreviewDrawer title={preview.title} kicker="PREVIEW · NO WRITE" onClose={() => setPreview(undefined)}><div className="drawer-section preview-copy"><p>{preview.detail}</p><div className="preview-diff"><span>当前快照</span><i/><span>建议状态</span></div><small>变更确认、审计记录和写回能力不在 Phase 1 范围内。</small></div></PreviewDrawer>}
  </Shell>;
}

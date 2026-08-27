import { type FormEvent, useEffect, useState } from "react";
import type { AdminSnapshot } from "./domain";
import { loadAdminSession, loadAdminSnapshot, loginAdminSession, logoutAdminSession, type AdminSessionState, type ReviewedDecision } from "./data";
import { AssetsScreen, PipelinesScreen, QualityScreen, ReviewScreen, SyncScreen, TodayScreen } from "./components/screens";
import { EmptyState, LoadingState, PreviewDrawer, Shell, type Screen } from "./components/system";

export interface AppProps { initialSnapshot?: AdminSnapshot; initialSession?: AdminSessionState }

function LoginGate({ onAuthenticated }: { onAuthenticated: (session: Extract<AdminSessionState, { kind: "authenticated" }>) => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "invalid" | "rate_limited" | "unavailable">("idle");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || status === "submitting") return;
    setStatus("submitting");
    void loginAdminSession("admin", password).then(result => {
      setPassword("");
      if (result.ok) onAuthenticated(result.session);
      else setStatus(result.reason);
    });
  };
  const message = status === "invalid" ? "账号或密码不正确。" : status === "rate_limited" ? "尝试次数过多，请稍后再试。" : status === "unavailable" ? "登录服务暂时不可用。" : "";
  return <main className="login-gate">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><span><strong>OpenDesign</strong><small>CONTROL ROOM</small></span></div>
      <small className="eyebrow">PRIVATE OPERATOR ACCESS</small>
      <h1 id="login-title">进入设计资源控制室</h1>
      <p>只读查看内容质量、审核队列、自动化管线与发布漂移。</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-username">账号</label>
        <input id="admin-username" name="username" value="admin" readOnly autoComplete="username"/>
        <label htmlFor="admin-password">密码</label>
        <input id="admin-password" name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required autoFocus/>
        {message && <p className="login-error" role="alert">{message}</p>}
        <button className="button button--solid" type="submit" disabled={status === "submitting"}>{status === "submitting" ? "正在验证…" : "登录控制室"}</button>
      </form>
      <small className="login-security">会话采用 Secure · HttpOnly Cookie，密码不会保存在浏览器。</small>
    </section>
  </main>;
}

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

  if (!initialSnapshot && session.kind === "loading") return <LoadingState/>;
  if (!initialSnapshot && session.kind === "unauthenticated") return <LoginGate onAuthenticated={setSession}/>;
  if (!initialSnapshot && session.kind === "unavailable") return <div className="fatal-state"><EmptyState title="登录服务不可用" detail="控制室保持关闭，没有回退到不受保护的快照。"/></div>;
  if (!snapshot && !loadError) return <LoadingState/>;
  if (!snapshot) return <div className="fatal-state"><EmptyState title="控制室快照不可用" detail={`${loadError}。没有把示例数据伪装成生产状态。`}/></div>;

  const counts = {
    review: snapshot.reviews.filter(item => item.status === "pending").length,
    quality: snapshot.decisions.filter(item => item.reviewStatus === "pending").length,
    assets: snapshot.assets.length,
    pipelines: snapshot.pipelines.filter(item => item.status === "failed").length,
  };
  const openPreview = (title: string, detail: string) => setPreview({ title, detail });
  const applyReviewedDecision = (reviewed: ReviewedDecision) => setSnapshot(current => current ? {
    ...current,
    decisions: current.decisions.map(decision => decision.id === reviewed.decisionId ? {
      ...decision,
      reviewStatus: reviewed.reviewStatus,
      finalRecommendation: reviewed.recommendation,
      reviewedAt: reviewed.reviewedAt,
      reviewedBy: reviewed.reviewedBy,
      reviewJudgment: {
        id: reviewed.reviewEventId,
        holderType: "user",
        holderId: reviewed.reviewedBy,
        subjectId: reviewed.subjectId,
        statement: reviewed.recommendation,
        asOf: reviewed.reviewedAt,
        recordedAt: reviewed.reviewedAt,
        reason: reviewed.reason,
        provenance: reviewed.provenance,
        supersedesDecisionId: reviewed.decisionId,
      },
      previewOnly: false,
    } : decision),
  } : current);

  const sessionControl = session.kind === "authenticated"
    ? <button type="button" className="session-control" onClick={() => { void logoutAdminSession().then(ok => { if (ok) setSession({ kind: "unauthenticated" }); }); }} aria-label={`退出管理员账号 ${session.actor.login}`}><span className="signal signal--good"/>{session.actor.login} · 退出</button>
    : session.kind === "unauthenticated"
      ? <span className="session-control session-control--muted">未登录</span>
      : session.kind === "unavailable"
        ? <span className="session-control session-control--muted">登录服务不可用</span>
        : <span className="session-control session-control--muted">检查登录状态…</span>;

  return <Shell screen={screen} onScreen={setScreen} source={snapshot.source.kind} generatedAt={snapshot.generatedAt} counts={counts} sessionControl={sessionControl} reviewEnabled={session.kind === "authenticated"}>
    {screen === "today" && <TodayScreen today={snapshot.today} reviews={snapshot.reviews} decisions={snapshot.decisions} pipelines={snapshot.pipelines} sync={snapshot.sync} onNavigate={setScreen} onPreview={openPreview}/>}
    {screen === "quality" && <QualityScreen decisions={snapshot.decisions} assets={snapshot.assets} canReview={session.kind === "authenticated"} onDecisionReviewed={applyReviewedDecision} onPreview={openPreview}/>}
    {screen === "review" && <ReviewScreen reviews={snapshot.reviews} assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "assets" && <AssetsScreen assets={snapshot.assets} onPreview={openPreview}/>} 
    {screen === "pipelines" && <PipelinesScreen pipelines={snapshot.pipelines} onPreview={openPreview}/>} 
    {screen === "sync" && <SyncScreen sync={snapshot.sync} diagnostics={snapshot.diagnostics} onPreview={openPreview}/>} 
    {preview && <PreviewDrawer title={preview.title} kicker="PREVIEW · NO WRITE" onClose={() => setPreview(undefined)}><div className="drawer-section preview-copy"><p>{preview.detail}</p><div className="preview-diff"><span>当前快照</span><i/><span>建议状态</span></div><small>变更确认、审计记录和写回能力不在当前只读阶段范围内。</small></div></PreviewDrawer>}
  </Shell>;
}

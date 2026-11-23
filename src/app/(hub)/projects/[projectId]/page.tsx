"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { addProjectMember, listProjects, removeProjectMember, type ProjectMember, type ResearchProject } from "@/lib/projects";
import { getToolSettings, type ToolSettings } from "@/lib/tool-settings";
import { refreshSsoSessionIfNeeded } from "@/lib/sso";

const EMPTY_TOOL_SETTINGS: ToolSettings = { paperLabUrl: "", writingLabUrl: "" };
type PaperLabHandoff = { popup: Window; state: string; projectId: string; origin: string; timer: number };

const HANDOFF_REQUEST = "paperlab.sso.handoff.request";
const REFRESH_REQUEST = "paperlab.sso.refresh.request";

function toolUrl(baseUrl: string | undefined, projectId: string): string | null {
  if (!baseUrl?.trim()) return null;
  try {
    const url = new URL(baseUrl.trim());
    url.searchParams.set("projectId", projectId);
    return url.toString();
  } catch {
    return null;
  }
}

function ToolIcon({ kind }: { kind: "paper" | "writing" }) {
  return kind === "paper" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.75h10l4 4v12.5H5z" /><path d="M15 3.75v4h4M8.5 12h7m-7 3.5h7" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 17.5 1.2-4.2L16.8 2.7a2 2 0 0 1 2.8 2.8L9 16.1 5 17.5Z" /><path d="M13.8 5.7 18 9.9M4 21h16" /></svg>
  );
}

function ProjectTool({ name, kind, href, onLaunch }: { name: string; kind: "paper" | "writing"; href: string | null; onLaunch?: () => void }) {
  const content = (
    <>
      <span className="project-tool-icon"><ToolIcon kind={kind} /></span>
      <span className="project-tool-copy">
        <strong>{name}</strong>
        <span>{href ? `Mở ${name} với workspace dự án này.` : "Chưa cấu hình địa chỉ kết nối."}</span>
      </span>
      <span className="project-tool-action">{href ? "Mở công cụ" : "Chưa kết nối"}{href && <span aria-hidden="true">↗</span>}</span>
    </>
  );

  return href && onLaunch ? (
    <button className="project-tool-card" type="button" onClick={onLaunch}>{content}</button>
  ) : href ? (
    <a className="project-tool-card" href={href} target="_blank" rel="noopener noreferrer">{content}</a>
  ) : (
    <div className="project-tool-card is-unavailable" aria-disabled="true">{content}</div>
  );
}

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const session = useResearchHubSession();
  const [projects, setProjects] = useState<ResearchProject[] | null>(null);
  const [error, setError] = useState("");
  const [handoffError, setHandoffError] = useState("");
  const [memberState, setMemberState] = useState<{ projectId: string; items: ProjectMember[] } | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberNotice, setMemberNotice] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
  const pendingHandoff = useRef<PaperLabHandoff | null>(null);
  const activeHandoffs = useRef(new Map<string, PaperLabHandoff>());
  const [toolSettingsState, setToolSettingsState] = useState<{ accessToken: string; settings: ToolSettings; error: string } | null>(null);

  useEffect(() => {
    let active = true;
    void listProjects(session.accessToken)
      .then((items) => { if (active) setProjects(items); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được workspace dự án.");
      });
    return () => { active = false; };
  }, [session.accessToken]);

  useEffect(() => {
    let active = true;
    void getToolSettings(session.accessToken)
      .then((settings) => { if (active) setToolSettingsState({ accessToken: session.accessToken, settings, error: "" }); })
      .catch((cause: unknown) => {
        if (active) setToolSettingsState({
          accessToken: session.accessToken,
          settings: EMPTY_TOOL_SETTINGS,
          error: cause instanceof Error ? cause.message : "Không tải được cấu hình công cụ.",
        });
      });
    return () => { active = false; };
  }, [session.accessToken]);

  const project = projects?.find((item) => item.id === projectId) ?? null;
  const members = memberState && memberState.projectId === project?.id ? memberState.items : project?.accessRole === "owner" ? project.members : [];
  const currentToolSettings = toolSettingsState?.accessToken === session.accessToken ? toolSettingsState : null;
  const toolSettings = currentToolSettings?.settings ?? EMPTY_TOOL_SETTINGS;
  const paperLabUrl = toolUrl(toolSettings.paperLabUrl, projectId);
  const writingLabUrl = toolUrl(toolSettings.writingLabUrl, projectId);
  const paperLabOrigin = paperLabUrl ? new URL(paperLabUrl).origin : "";

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || project.accessRole !== "owner" || memberBusy) return;
    setMemberBusy(true);
    setMemberError("");
    setMemberNotice("");
    try {
      setMemberState({ projectId: project.id, items: await addProjectMember(session.accessToken, project.id, memberEmail.trim()) });
      setMemberEmail("");
      setMemberNotice("Đã thêm thành viên vào project.");
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : "Không thêm được thành viên.");
    } finally {
      setMemberBusy(false);
    }
  }

  function handleRemoveMember(member: ProjectMember) {
    if (!project || project.accessRole !== "owner" || memberBusy) return;
    setMemberToRemove(member);
  }

  async function confirmRemoveMember() {
    const member = memberToRemove;
    setMemberToRemove(null);
    if (!project || !member || project.accessRole !== "owner" || memberBusy) return;
    setMemberBusy(true);
    setMemberError("");
    setMemberNotice("");
    try {
      setMemberState({ projectId: project.id, items: await removeProjectMember(session.accessToken, project.id, member.id) });
      setMemberNotice(`Đã gỡ ${member.email} khỏi project.`);
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : "Không gỡ được thành viên.");
    } finally {
      setMemberBusy(false);
    }
  }

  useEffect(() => {
    function onHandoffRequest(event: MessageEvent<unknown>) {
      if (!project || !event.data || typeof event.data !== "object") return;
      const request = event.data as Record<string, unknown>;
      if (request.type === HANDOFF_REQUEST) {
        const pending = pendingHandoff.current;
        if (!pending || event.source !== pending.popup || event.origin !== pending.origin || project.id !== pending.projectId || request.state !== pending.state || request.projectId !== pending.projectId) return;
        void (async () => {
          const fresh = await refreshSsoSessionIfNeeded().catch(() => null);
          const accessToken = fresh?.accessToken ?? session.accessToken;
          const expiresAt = fresh?.expiresAt ?? session.expiresAt;
          if (pendingHandoff.current?.state !== pending.state) return;
          if (expiresAt <= Date.now()) {
            pending.popup.postMessage({ type: "researchhub.sso.handoff.response", state: pending.state, projectId: pending.projectId, error: "session_expired" }, pending.origin);
          } else {
            pending.popup.postMessage({ type: "researchhub.sso.handoff.response", state: pending.state, projectId: pending.projectId, accessToken, expiresAt }, pending.origin);
            activeHandoffs.current.set(pending.state, pending);
            setHandoffError("");
          }
          window.clearTimeout(pending.timer);
          if (pendingHandoff.current?.state === pending.state) pendingHandoff.current = null;
        })();
        return;
      }
      if (request.type !== REFRESH_REQUEST || typeof request.state !== "string" || typeof request.requestId !== "string") return;
      const active = activeHandoffs.current.get(request.state);
      if (!active || event.source !== active.popup || event.origin !== active.origin || project.id !== active.projectId || active.popup.closed) return;
      void refreshSsoSessionIfNeeded().then((fresh) => {
        if (!fresh || fresh.expiresAt <= Date.now()) throw new Error("expired");
        if (activeHandoffs.current.get(active.state) !== active || active.popup.closed) return;
        active.popup.postMessage({ type: "researchhub.sso.refresh.response", state: active.state, projectId: active.projectId, requestId: request.requestId, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt }, active.origin);
      }).catch(() => {
        if (activeHandoffs.current.get(active.state) !== active || active.popup.closed) return;
        active.popup.postMessage({ type: "researchhub.sso.refresh.response", state: active.state, projectId: active.projectId, requestId: request.requestId, error: "session_expired" }, active.origin);
      });
    }
    window.addEventListener("message", onHandoffRequest);
    return () => window.removeEventListener("message", onHandoffRequest);
  }, [project, session.accessToken, session.expiresAt]);

  useEffect(() => () => {
    const pending = pendingHandoff.current;
    if (pending) window.clearTimeout(pending.timer);
    pendingHandoff.current = null;
  }, []);

  function openPaperLab() {
    if (!paperLabUrl || !project || !paperLabOrigin) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setHandoffError("Trình duyệt đã chặn tab mới. Hãy cho phép popup của ResearchHub rồi thử lại.");
      return;
    }
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const state = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const timer = window.setTimeout(() => {
      const pending = pendingHandoff.current;
      if (pending?.state !== state) return;
      pendingHandoff.current = null;
      setHandoffError("PaperLab không phản hồi phiên SSO. Hãy kiểm tra cấu hình nguồn ResearchHub trong PaperLab rồi mở lại.");
    }, 20_000);
    pendingHandoff.current = { popup, state, projectId, origin: paperLabOrigin, timer };
    const target = new URL(paperLabUrl);
    target.searchParams.set("rh_handoff", state);
    popup.location.replace(target.toString());
  }

  return (
    <section className="hub-page-content">
      <nav className="project-breadcrumb" aria-label="Điều hướng">
        <Link href="/projects">Dự án</Link><span aria-hidden="true">/</span><span>Workspace</span>
      </nav>

      {error ? (
        <div className="notice notice-error" role="alert">{error}</div>
      ) : !projects ? (
        <div className="project-empty" role="status"><span className="spinner" /><p>Đang tải workspace…</p></div>
      ) : !project ? (
        <div className="project-empty">
          <h3>Không tìm thấy dự án</h3>
          <p>Dự án không tồn tại hoặc không thuộc tài khoản của bạn.</p>
          <Link className="project-back-link" href="/projects">Quay lại danh sách dự án</Link>
        </div>
      ) : (
        <>
          <header className="hub-page-heading project-workspace-heading">
            <p className="eyebrow">WORKSPACE DỰ ÁN</p>
            <h1>{project.name}</h1>
            <p className="intro-copy">{project.description || "Chọn công cụ để tiếp tục làm việc trong dự án này."}</p>
          </header>

          <section className="project-tools" aria-labelledby="project-tools-title">
            <div className="project-tools-heading">
              <div>
                <p className="eyebrow">CÔNG CỤ</p>
                <h2 id="project-tools-title">Tiếp tục với</h2>
              </div>
              <code className="project-id">ID: {project.id}</code>
            </div>
            {currentToolSettings?.error && <div className="notice notice-error" role="alert">{currentToolSettings.error}</div>}
            {handoffError && <div className="notice notice-error" role="alert">{handoffError}</div>}
            <div className="project-tools-grid">
              <ProjectTool name="PaperLab" kind="paper" href={paperLabUrl} onLaunch={openPaperLab} />
              <ProjectTool name="Writing Lab" kind="writing" href={writingLabUrl} />
            </div>
            <p className="project-tools-note">Hai công cụ sẽ nhận ID ổn định này khi được kết nối.</p>
          </section>

          {project.accessRole === "owner" ? (
            <section className="project-members-panel" aria-labelledby="project-members-title">
              <div className="project-members-heading">
                <div><p className="eyebrow">CỘNG TÁC</p><h2 id="project-members-title">Thành viên <span className="count">{members.length.toString().padStart(2, "0")}</span></h2></div>
                <span className="project-owner-badge">Owner · {session.profile.email}</span>
              </div>
              <p className="project-members-help">Chỉ thêm được tài khoản HyperDataLab đã xác minh và từng đăng nhập Research Hub. Thành viên có thể dùng công cụ và quản lý file trong project.</p>
              <form className="project-member-form" onSubmit={(event) => void handleAddMember(event)}>
                <label htmlFor="project-member-email">Email thành viên</label>
                <input id="project-member-email" type="email" autoComplete="off" required pattern="[^@]+@hyperdatalab[.]org" placeholder="ten@hyperdatalab.org" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} disabled={memberBusy} />
                <button className="project-create-button" type="submit" disabled={memberBusy}>{memberBusy ? <><span className="spinner" /> Đang xử lý</> : "Thêm thành viên"}</button>
              </form>
              {memberError && <div className="notice notice-error" role="alert">{memberError}</div>}
              {memberNotice && <div className="notice notice-success" role="status">{memberNotice}</div>}
              {members.length ? <ul className="project-member-list">{members.map((member) => <li key={member.id}><span className="project-member-avatar" aria-hidden="true">{(member.name || member.email).slice(0, 1).toUpperCase()}</span><span className="project-member-identity"><strong>{member.name || member.email}</strong><small>{member.email}</small></span><button type="button" onClick={() => void handleRemoveMember(member)} disabled={memberBusy}>Gỡ</button></li>)}</ul> : <div className="project-members-empty">Chưa có thành viên nào khác trong project.</div>}
            </section>
          ) : (
            <section className="project-members-panel project-shared-notice"><p className="eyebrow">PROJECT ĐƯỢC CHIA SẺ</p><p>Bạn là thành viên của project do <strong>{project.ownerEmail || "owner"}</strong> sở hữu. Bạn có thể cộng tác với công cụ và các file trong project.</p></section>
          )}
        </>
      )}
      {memberToRemove && <ConfirmDialog title="Gỡ thành viên khỏi project?" description={`${memberToRemove.email} sẽ mất quyền truy cập workspace và file của project này.`} confirmLabel="Gỡ thành viên" onCancel={() => setMemberToRemove(null)} onConfirm={() => void confirmRemoveMember()} />}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { listProjects, type ResearchProject } from "@/lib/projects";

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

function ProjectTool({ name, kind, href }: { name: string; kind: "paper" | "writing"; href: string | null }) {
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

  return href ? (
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

  useEffect(() => {
    let active = true;
    void listProjects(session.accessToken)
      .then((items) => { if (active) setProjects(items); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được workspace dự án.");
      });
    return () => { active = false; };
  }, [session.accessToken]);

  const project = projects?.find((item) => item.id === projectId) ?? null;
  const paperLabUrl = toolUrl(process.env.NEXT_PUBLIC_PAPERLAB_URL, projectId);
  const writingLabUrl = toolUrl(process.env.NEXT_PUBLIC_WRITING_LAB_URL, projectId);

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
            <div className="project-tools-grid">
              <ProjectTool name="PaperLab" kind="paper" href={paperLabUrl} />
              <ProjectTool name="Writing Lab" kind="writing" href={writingLabUrl} />
            </div>
            <p className="project-tools-note">Hai công cụ sẽ nhận ID ổn định này khi được kết nối.</p>
          </section>
        </>
      )}
    </section>
  );
}

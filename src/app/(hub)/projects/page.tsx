"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { createProject, listProjects, type ResearchProject } from "@/lib/projects";

export default function ProjectsPage() {
  const session = useResearchHubSession();
  const [listState, setListState] = useState<{ accessToken: string; items: ResearchProject[]; error: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;
    void listProjects(session.accessToken)
      .then((items) => { if (active) setListState({ accessToken: session.accessToken, items, error: "" }); })
      .catch((cause: unknown) => {
        if (active) setListState({
          accessToken: session.accessToken,
          items: [],
          error: cause instanceof Error ? cause.message : "Không tải được danh sách dự án.",
        });
      });
    return () => { active = false; };
  }, [session.accessToken]);

  const projects = listState?.accessToken === session.accessToken ? listState.items : [];
  const loading = !listState || listState.accessToken !== session.accessToken;
  const listError = listState?.accessToken === session.accessToken ? listState.error : "";

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const projectName = name.trim();
    if (!projectName) {
      setSaveError("Vui lòng nhập tên dự án.");
      document.getElementById("project-name")?.focus();
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const project = await createProject(session.accessToken, { name: projectName, description: description.trim() });
      setListState((current) => ({
        accessToken: session.accessToken,
        items: [project, ...(current?.accessToken === session.accessToken ? current.items : [])],
        error: "",
      }));
      setName("");
      setDescription("");
      setFormOpen(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Không thể tạo dự án.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hub-page-content" aria-busy={loading || saving}>
      <header className="hub-page-heading">
        <p className="eyebrow">RESEARCH HUB <span>·</span> KHÔNG GIAN LÀM VIỆC</p>
        <h1>Dự án nghiên cứu</h1>
        <p className="intro-copy">Tạo và quản lý các dự án cá nhân, sẵn sàng kết nối với PaperLab và Writing.</p>
      </header>

      <section className="projects-section" aria-labelledby="projects-title">
        <div className="projects-heading">
          <div>
            <p className="eyebrow">KHÔNG GIAN CỦA BẠN</p>
            <h2 id="projects-title">Dự án của bạn <span className="count">{projects.length.toString().padStart(2, "0")}</span></h2>
          </div>
          <button className="project-create-button" type="button" onClick={() => { setFormOpen((open) => !open); setSaveError(""); }} disabled={loading || saving} aria-expanded={formOpen} aria-controls="project-create-form">
            <span aria-hidden="true">+</span> Tạo dự án
          </button>
        </div>

        {(listError || saveError) && <div className="notice notice-error" role="alert">{saveError || listError}</div>}

        {formOpen && (
          <form className="project-form" id="project-create-form" onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="project-name">Tên dự án <span>(bắt buộc)</span></label>
            <input id="project-name" name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="off" required />
            <label htmlFor="project-description">Mô tả <span>(không bắt buộc)</span></label>
            <textarea id="project-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} />
            <div className="project-form-actions">
              <button className="project-cancel-button" type="button" onClick={() => { setFormOpen(false); setSaveError(""); setName(""); setDescription(""); }}>Hủy</button>
              <button className="project-create-button" type="submit" disabled={saving}>
                {saving ? <><span className="spinner" /> Đang tạo</> : "Tạo dự án"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="project-empty" role="status"><span className="spinner" /><p>Đang tải danh sách dự án…</p></div>
        ) : projects.length ? (
          <div className="project-table-scroll" aria-live="polite">
            <table className="project-table" aria-label="Danh sách dự án của bạn">
              <thead>
                <tr><th scope="col">Tên dự án</th><th scope="col">Mô tả</th><th scope="col">Ngày tạo</th></tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr data-project-id={project.id} key={project.id}>
                    <th className="project-table-name" scope="row"><Link className="project-name-link" href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link></th>
                    <td className="project-table-description">{project.description || <span className="project-table-empty">—</span>}</td>
                    <td className="project-table-date"><time dateTime={project.createdAt}>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(project.createdAt))}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !listError && (
          <div className="project-empty">
            <h3>Chưa có dự án</h3>
            <p>Tạo dự án đầu tiên để bắt đầu xây dựng không gian nghiên cứu của bạn.</p>
          </div>
        )}
      </section>
    </section>
  );
}

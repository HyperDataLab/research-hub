"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { createProject, deleteProject, listProjects, restoreProject, type ResearchProject } from "@/lib/projects";

export default function ProjectsPage() {
  const session = useResearchHubSession();
  const [listState, setListState] = useState<{ accessToken: string; items: ResearchProject[]; error: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");

  useEffect(() => {
    let active = true;
    void listProjects(session.accessToken, true)
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

  const allProjects = listState?.accessToken === session.accessToken ? listState.items : [];
  const projects = allProjects.filter((project) => view === "archived" ? Boolean(project.deletedAt) : !project.deletedAt);
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

  async function handleArchive(project: ResearchProject) {
    if (!window.confirm("Chuyển “" + project.name + "” vào lưu trữ? File trong project sẽ được giữ nguyên.")) return;
    setSaveError("");
    try {
      const archived = await deleteProject(session.accessToken, project.id);
      setListState((current) => current?.accessToken === session.accessToken
        ? { ...current, items: current.items.map((item) => item.id === archived.id ? archived : item) }
        : current);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Không lưu trữ được project.");
    }
  }

  async function handleRestore(project: ResearchProject) {
    setSaveError("");
    try {
      const restored = await restoreProject(session.accessToken, project.id);
      setListState((current) => current?.accessToken === session.accessToken
        ? { ...current, items: current.items.map((item) => item.id === restored.id ? restored : item) }
        : current);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Không khôi phục được project.");
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
            <h2 id="projects-title">{view === "active" ? "Dự án của bạn" : "Project lưu trữ"} <span className="count">{projects.length.toString().padStart(2, "0")}</span></h2>
          </div>
          <div className="projects-heading-actions">
            <div className="project-view-tabs" role="tablist" aria-label="Loại project">
              <button type="button" role="tab" aria-selected={view === "active"} className={view === "active" ? "is-active" : ""} onClick={() => setView("active")}>Đang hoạt động</button>
              <button type="button" role="tab" aria-selected={view === "archived"} className={view === "archived" ? "is-active" : ""} onClick={() => setView("archived")}>Lưu trữ</button>
            </div>
            {view === "active" && <button className="project-create-button" type="button" onClick={() => { setFormOpen((open) => !open); setSaveError(""); }} disabled={loading || saving} aria-expanded={formOpen} aria-controls="project-create-form">
              <span aria-hidden="true">+</span> Tạo dự án
            </button>}
          </div>
        </div>

        {(listError || saveError) && <div className="notice notice-error" role="alert">{saveError || listError}</div>}

        {formOpen && view === "active" && (
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
                <tr><th scope="col">Tên dự án</th><th scope="col">Mô tả</th><th scope="col">Ngày tạo</th><th scope="col">Thao tác</th></tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr data-project-id={project.id} key={project.id}>
                    <th className="project-table-name" scope="row">{view === "active" ? <Link className="project-name-link" href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link> : project.name}</th>
                    <td className="project-table-description">{project.description || <span className="project-table-empty">—</span>}</td>
                    <td className="project-table-date"><time dateTime={project.createdAt}>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(project.createdAt))}</time></td>
                    <td className="project-table-actions">{view === "active" ? <button type="button" onClick={() => void handleArchive(project)}>Lưu trữ</button> : <button type="button" onClick={() => void handleRestore(project)}>Khôi phục</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !listError && (
          <div className="project-empty">
            <h3>{view === "active" ? "Chưa có dự án" : "Chưa có project lưu trữ"}</h3>
            <p>{view === "active" ? "Tạo dự án đầu tiên để bắt đầu xây dựng không gian nghiên cứu của bạn." : "Project được lưu trữ sẽ xuất hiện ở đây. File của chúng vẫn được giữ trong Tệp của bạn."}</p>
          </div>
        )}
      </section>
    </section>
  );
}

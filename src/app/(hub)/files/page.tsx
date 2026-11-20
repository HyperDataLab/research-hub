"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { assignFileToProject, deleteFile, downloadFile, type StoredFile, uploadFile } from "@/lib/files";
import { listProjects, type ResearchProject } from "@/lib/projects";
import { getFileStoreServerSnapshot, getFileStoreSnapshot, refreshFileStore, removeFileFromStore, subscribeFileStore } from "@/lib/file-store";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 0; size >= 1024 && index < units.length - 1; index += 1) {
    size /= 1024;
    unit = units[index + 1];
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`;
};

function fileKind(file: StoredFile) {
  if (file.contentType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "PDF";
  if (file.contentType.startsWith("image/")) return "IMG";
  if (file.name.toLowerCase().match(/\.(docx?|odt)$/)) return "DOC";
  if (file.name.toLowerCase().match(/\.(xlsx?|csv)$/)) return "XLS";
  return "FILE";
}

export default function FilesPage() {
  const session = useResearchHubSession();
  const fileStore = useSyncExternalStore(subscribeFileStore, getFileStoreSnapshot, getFileStoreServerSnapshot);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [projectState, setProjectState] = useState<{ accessToken: string; items: ResearchProject[]; error: string } | null>(null);
  const [assigningFileId, setAssigningFileId] = useState("");
  const files = fileStore.items;

  useEffect(() => { void refreshFileStore(session.accessToken); }, [session.accessToken]);

  useEffect(() => {
    let active = true;
    void listProjects(session.accessToken, true)
      .then((items) => { if (active) setProjectState({ accessToken: session.accessToken, items, error: "" }); })
      .catch((cause: unknown) => {
        if (active) setProjectState({ accessToken: session.accessToken, items: [], error: cause instanceof Error ? cause.message : "Không tải được project." });
      });
    return () => { active = false; };
  }, [session.accessToken]);

  const currentProjectState = projectState?.accessToken === session.accessToken ? projectState : null;
  const projects = useMemo(() => currentProjectState?.items ?? [], [currentProjectState]);
  const activeProjects = useMemo(() => projects.filter((project) => !project.deletedAt), [projects]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const visibleFiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return files.filter((file) => {
      const matchesName = file.name.toLocaleLowerCase().includes(normalized);
      const matchesProject = projectFilter === "all" ||
        (projectFilter === "__unassigned__" ? !file.projectId : file.projectId === projectFilter);
      return matchesName && matchesProject;
    });
  }, [files, query, projectFilter]);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  async function handleUpload(selected: FileList | null) {
    const file = selected?.[0];
    if (!file) return;
    if (!activeProjects.some((project) => project.id === projectId)) {
      setError("Hãy chọn project đang hoạt động trước khi tải file.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("File vượt giới hạn 25 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await uploadFile(session.accessToken, projectId, file);
      await refreshFileStore(session.accessToken);
      setNotice(`Đã tải lên “${file.name}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tải file lên thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignProject(file: StoredFile, targetProjectId: string) {
    if (!targetProjectId || assigningFileId) return;
    setAssigningFileId(file.id);
    setError("");
    setNotice("");
    try {
      await assignFileToProject(session.accessToken, file.id, targetProjectId);
      await refreshFileStore(session.accessToken);
      setNotice(`Đã gắn tài liệu “${file.name}” vào project.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gắn được file vào project.");
    } finally {
      setAssigningFileId("");
    }
  }

  async function handleDownload(file: StoredFile) {
    try {
      setError("");
      await downloadFile(session.accessToken, file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được file.");
    }
  }

  async function handleDelete(file: StoredFile) {
    if (!window.confirm(`Xóa “${file.name}”?`)) return;
    try {
      setError("");
      await deleteFile(session.accessToken, file.id);
      removeFileFromStore(file.id);
      setNotice("Đã xóa file.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được file.");
    }
  }

  return (
    <section className="hub-page-content">
      <header className="hub-page-heading">
        <p className="eyebrow">RESEARCH HUB <span>·</span> KHO TÀI LIỆU</p>
        <h1>Tệp của bạn</h1>
        <p className="intro-copy">Tệp được lưu riêng và chỉ mở bằng tài khoản HyperDataLab đã xác minh.</p>
      </header>

      <section className="upload-panel" aria-label="Tải file lên">
        <div className="upload-copy">
          <div className="upload-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.25c0 .97.78 1.75 1.75 1.75h10.5c.97 0 1.75-.78 1.75-1.75V14" /></svg></div>
          <div><h2>Tải tài liệu lên</h2><p>Chọn project trước. Mỗi file sẽ thuộc đúng một project. Tối đa 25 MB.</p></div>
        </div>
        <label className="upload-project-select" htmlFor="upload-project-id">
          <span>Project</span>
          <select id="upload-project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={!currentProjectState || activeProjects.length === 0 || busy}>
            <option value="">{!currentProjectState ? "Đang tải project…" : activeProjects.length ? "Chọn project" : "Chưa có project đang hoạt động"}</option>
            {activeProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className={`upload-button ${busy ? "is-busy" : ""}`}>
          {busy ? <><span className="spinner" /> Đang tải lên</> : <>Chọn file <span>↗</span></>}
          <input type="file" onChange={(event) => { void handleUpload(event.target.files); event.currentTarget.value = ""; }} disabled={busy || fileStore.loading || !projectId || !activeProjects.some((project) => project.id === projectId)} />
        </label>
      </section>

      {currentProjectState?.error && <div className="notice notice-error" role="alert">{currentProjectState.error}</div>}
      {currentProjectState && activeProjects.length === 0 && !currentProjectState.error && <div className="notice" role="status">Hãy <Link href="/projects">tạo project</Link> trước khi tải file.</div>}
      {files.some((file) => !file.projectId) && <div className="notice legacy-file-notice" role="status">Còn {files.filter((file) => !file.projectId).length} file cũ chưa gắn project. Chọn project trong từng dòng để hoàn tất chuyển đổi.</div>}

      {(error || fileStore.error || notice) && <div className={`notice ${error || fileStore.error ? "notice-error" : "notice-success"}`} role="status">{error || fileStore.error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label="Đóng thông báo">×</button></div>}

      <div className="section-heading">
        <div><p className="eyebrow">THƯ VIỆN</p><h2>Tệp của bạn <span className="count">{files.length.toString().padStart(2, "0")}</span></h2></div>
        <div className="library-tools">
          <label className="project-filter-select"><span>Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="Lọc theo project"><option value="all">Tất cả project</option><option value="__unassigned__">Chưa gắn project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}{project.deletedAt ? " (Lưu trữ)" : ""}</option>)}</select></label>
          <label className="search-box"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.7" /><path d="m13 13 4 4" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tài liệu" aria-label="Tìm tài liệu" /></label>
          <button className="refresh-button" onClick={() => { setError(""); void refreshFileStore(session.accessToken); }} title="Tải lại danh sách" aria-label="Tải lại danh sách"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 8A6.4 6.4 0 0 0 5 5.3L3.6 6.8M3.8 4.2v2.9h2.9M3.8 12a6.4 6.4 0 0 0 11.2 2.7l1.4-1.5m-.2 2.6v-2.9h-2.9" /></svg></button>
        </div>
      </div>

      <section className="file-table" aria-label="Danh sách file" aria-busy={fileStore.loading}>
        <div className="file-head"><span>TÊN TỆP</span><span>PROJECT</span><span>KÍCH THƯỚC</span><span>NGÀY TẢI LÊN</span><span /></div>
        {fileStore.loading ? <div className="empty-state"><span className="spinner" /><p>Đang kết nối không gian…</p></div> : visibleFiles.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75h8l4 4v12.5H6z" /><path d="M14 3.75v4h4M9 12h6m-6 3.5h6" /></svg></div><h3>{query || projectFilter !== "all" ? "Không tìm thấy tài liệu" : "Chưa có tài liệu nào"}</h3><p>{query || projectFilter !== "all" ? "Thử từ khóa hoặc project khác." : "Tải tài liệu đầu tiên lên để bắt đầu."}</p></div>
        ) : visibleFiles.map((file) => (
          <article className="file-row" key={file.id}>
            <div className="file-name"><span className={`file-type type-${fileKind(file).toLowerCase()}`}>{fileKind(file)}</span><span title={file.name}>{file.name}</span></div>
            <div className="file-project-cell">
              {file.projectId ? <span className={`file-project-tag${projectById.get(file.projectId)?.deletedAt ? " is-archived" : ""}`}>{projectById.get(file.projectId)?.name ?? "Project không còn trong danh sách"}{projectById.get(file.projectId)?.deletedAt && <small>Lưu trữ</small>}</span> : (
                <select aria-label={`Gắn ${file.name} vào project`} value="" disabled={assigningFileId === file.id || activeProjects.length === 0} onChange={(event) => void handleAssignProject(file, event.target.value)}>
                  <option value="">{assigningFileId === file.id ? "Đang gắn…" : "Chọn project…"}</option>
                  {activeProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
              )}
            </div>
            <span className="file-size">{formatBytes(file.size)}</span>
            <span className="file-date">{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(file.uploadedAt))}</span>
            <div className="file-actions">
              <button onClick={() => void handleDownload(file)} aria-label={`Tải ${file.name}`} title="Tải xuống">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.75v9.5m0 0 3.5-3.5M10 12.25l-3.5-3.5M3.25 13.5v2.25c0 .55.45 1 1 1h11.5c.55 0 1-.45 1-1V13.5" /></svg>
              </button>
              <button className="file-delete" onClick={() => void handleDelete(file)} aria-label={`Xóa ${file.name}`} title="Xóa">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11m-9.5 0 .6 10h6.8L14 6m-6-2h4l.75 2h-5.5L8 4Zm.5 4v5m3-5v5" /></svg>
              </button>
            </div>
          </article>
        ))}
      </section>

      <footer className="storage-footer"><span><i /> Đang lưu trên Cloudflare R2</span><span>{files.length} file <b>·</b> {formatBytes(totalSize)} đang dùng</span></footer>
    </section>
  );
}

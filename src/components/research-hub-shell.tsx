"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BrandHeader } from "@/components/brand-header";
import { clearFileStore } from "@/lib/file-store";
import { registerResearchHubUser } from "@/lib/projects";
import {
  endSsoSession,
  getSsoConfigurationIssues,
  getSsoSessionRaw,
  isSsoAdminRole,
  logPendingSsoUserInfoDiagnostics,
  hydrateSsoSessionFromCallback,
  isSsoConfigured,
  parseSsoSession,
  startSsoLogin,
  startSsoSessionAutoRefresh,
  subscribeSsoSession,
  type SsoSession,
} from "@/lib/sso";

const SessionContext = createContext<SsoSession | null>(null);

export function useResearchHubSession(): SsoSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Research Hub session is unavailable.");
  return session;
}

function LoginPage() {
  const [error, setError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => {
    const reasons = getSsoConfigurationIssues();
    if (loginBusy) reasons.push("SSO sign-in redirect is in progress");
    if (reasons.length > 0) {
      console.warn("[Research Hub] SSO sign-in button is disabled", { reasons });
    }
  }, [loginBusy]);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".login-page");
    if (!page || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver((entries, currentObserver) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        element.classList.remove("reveal-pending");
        element.classList.add("reveal-visible");
        currentObserver.unobserve(element);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

    page.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
      if (element.getBoundingClientRect().top < window.innerHeight - 24) {
        element.classList.add("reveal-visible");
        return;
      }
      element.classList.add("reveal-pending");
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  async function handleSignIn() {
    setLoginBusy(true);
    setError("");
    try {
      await startSsoLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể bắt đầu đăng nhập SSO.");
      setLoginBusy(false);
    }
  }

  return (
    <section className="login-page" id="home">
      <div className="login-hero">
        <div className="login-copy">
          <p className="login-kicker"><span aria-hidden="true" /> NỀN TẢNG LÀM VIỆC NGHIÊN CỨU</p>
          <h1>Nghiên cứu, kết nối trong một không gian.</h1>
          <p className="login-lede">Research Hub giúp nhóm nghiên cứu tổ chức project, quản lý tài liệu theo đúng project và mở nhanh các công cụ chuyên môn.</p>
          <div className="login-benefits" aria-label="Điểm nổi bật">
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>Không gian theo project</span>
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>Chia sẻ đúng thành viên</span>
            <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>Kết nối công cụ nghiên cứu</span>
          </div>
          <p className="login-help">Dành cho thành viên HyperDataLab. Chưa có quyền truy cập? Hãy liên hệ quản trị viên của tổ chức.</p>
        </div>

        <div className="login-access-column">
          <section className="login-card" id="login-access" aria-labelledby="login-card-title">
            <div className="login-card-heading">
              <span className="login-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></svg></span>
              <div>
                <p className="login-card-label">TRUY CẬP TỔ CHỨC</p>
                <h2 id="login-card-title">Đăng nhập vào Research Hub</h2>
              </div>
            </div>
            <p className="login-note">Tiếp tục bằng tài khoản HyperDataLab đã xác minh email <strong>@hyperdatalab.org</strong>.</p>
            <button className="sso-button" onClick={() => void handleSignIn()} disabled={!isSsoConfigured || loginBusy} aria-busy={loginBusy}>
              {loginBusy ? <><span className="spinner" /> Đang chuyển tới SSO</> : <>Tiếp tục với HyperDataLab SSO <span aria-hidden="true">↗</span></>}
            </button>
            {!isSsoConfigured && <p className="config-hint">Đăng nhập SSO hiện chưa sẵn sàng. Vui lòng thử lại sau.</p>}
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <p className="login-secure-note"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2" /><path d="M7 8V6a3 3 0 0 1 6 0v2" /></svg> Xác thực an toàn qua HyperDataLab SSO</p>
          </section>

          <div className="login-preview" role="img" aria-label="Minh họa workspace Research Hub với project nghiên cứu, kho tài liệu và các công cụ PaperLab, Writing Lab">
            <div className="preview-browser-bar">
              <span className="preview-window-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="preview-address"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg> researchhub.hyperdatalab.org</span>
            </div>
            <div className="preview-workspace">
              <div className="preview-sidebar" aria-hidden="true">
                <span className="preview-brand-mark">R</span>
                <span className="preview-nav-item is-active"><i /> Dự án</span>
                <span className="preview-nav-item"><i /> Tệp của bạn</span>
              </div>
              <div className="preview-content">
                <p className="preview-eyebrow">PROJECT WORKSPACE</p>
                <h3>Nghiên cứu hệ sinh thái biển</h3>
                <p className="preview-description">Tài liệu và công cụ được tổ chức theo cùng một project.</p>
                <div className="preview-tools" aria-hidden="true">
                  <span><i className="preview-tool-icon paper-icon">P</i><b>PaperLab</b><small>Đọc và phân tích bài báo</small></span>
                  <span><i className="preview-tool-icon writing-icon">W</i><b>Writing Lab</b><small>Hỗ trợ viết học thuật</small></span>
                </div>
                <div className="preview-file-line" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5z" /><path d="M12 2.5v3h3m-7 4h4m-4 3h4" /></svg><span>Tài liệu được gắn với project</span><b>Theo project</b></div>
              </div>
            </div>
            <p className="preview-caption">Minh họa giao diện · Tài liệu, cộng tác và công cụ cùng kết nối.</p>
          </div>
        </div>
      </div>

      <section className="login-capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="capabilities-heading" data-reveal="up">
          <p className="eyebrow">ĐƯỢC THIẾT KẾ QUANH PROJECT</p>
          <h2 id="capabilities-title">Giữ câu hỏi nghiên cứu, tài liệu và nhóm cộng tác trong cùng một mạch làm việc.</h2>
          <p className="capabilities-intro">Mỗi project là điểm gặp nhau của con người, dữ liệu và công cụ—để nhóm biết mình đang làm gì và bước tiếp theo ở đâu.</p>
        </div>
        <div className="capabilities-list">
          <article className="capability-item" data-reveal="up">
            <span className="capability-number">01 <i>PROJECT</i></span>
            <div><h3>Tổ chức theo mục tiêu nghiên cứu</h3><p>Tạo project với tên và mô tả rõ ràng, sau đó mời thành viên HyperDataLab cùng làm việc trong đúng không gian.</p><ul><li>Chia sẻ project theo tài khoản tổ chức</li><li>Phân biệt quyền owner và member</li><li>Lưu trữ hoặc khôi phục project khi cần</li></ul></div>
          </article>
          <article className="capability-item" data-reveal="up">
            <span className="capability-number">02 <i>FILES</i></span>
            <div><h3>Giữ tài liệu đúng ngữ cảnh</h3><p>Tệp được gắn với project cụ thể, giúp việc tìm, tải xuống và cộng tác không bị tách rời khỏi đề tài.</p><ul><li>Lọc thư viện theo project</li><li>Gắn file vào project phù hợp</li><li>File vẫn được giữ khi project lưu trữ</li></ul></div>
          </article>
          <article className="capability-item" data-reveal="up">
            <span className="capability-number">03 <i>TOOLS</i></span>
            <div><h3>Nối tiếp công việc bằng công cụ</h3><p>Mở các công cụ chuyên môn ngay từ project để tiếp tục đọc, phân tích và phát triển bản thảo.</p><ul><li>PaperLab cho bài báo và phân tích</li><li>Writing Lab cho quy trình viết</li><li>Project ID giữ nguyên ngữ cảnh kết nối</li></ul></div>
          </article>
        </div>
      </section>

      <section className="login-workflow" id="workflow" aria-labelledby="workflow-title">
        <header className="landing-section-heading" data-reveal="up">
          <div><p className="eyebrow">BẮT ĐẦU ĐƠN GIẢN</p><h2 id="workflow-title">Ba bước để đưa nghiên cứu vào guồng.</h2></div>
          <p>Từ lần đăng nhập đầu tiên đến lúc nhóm mở đúng công cụ, mọi thứ đều bắt đầu từ project.</p>
        </header>
        <ol className="workflow-steps">
          <li data-reveal="up"><span className="workflow-step-number">01</span><div><h3>Đăng nhập tổ chức</h3><p>Dùng HyperDataLab SSO với email <strong>@hyperdatalab.org</strong> đã xác minh.</p></div></li>
          <li data-reveal="up"><span className="workflow-step-number">02</span><div><h3>Tạo project và mời nhóm</h3><p>Đặt tên, mô tả mục tiêu rồi thêm thành viên đã sử dụng Research Hub.</p></div></li>
          <li data-reveal="up"><span className="workflow-step-number">03</span><div><h3>Thêm tài liệu, mở công cụ</h3><p>Gắn file vào project và tiếp tục công việc trong PaperLab hoặc Writing Lab.</p></div></li>
        </ol>
      </section>

      <section className="login-integrations" id="integrations" aria-labelledby="integrations-title">
        <header className="integration-directory-intro" data-reveal="up">
          <h2 id="integrations-title">Công cụ cho nhóm nghiên cứu</h2>
        </header>
        <ul className="integration-catalog" aria-label="Công cụ cho nhóm nghiên cứu">
          <li className="integration-product integration-product-hub" data-reveal="up">
            <div className="integration-product-name">
              <Image src="/research-hub-logo.png" alt="" width={36} height={36} />
              <h3>Research Hub</h3>
            </div>
            <p>Tạo project, quản lý tài liệu và mời thành viên cộng tác.</p>
          </li>
          <li className="integration-product" data-reveal="up">
            <div className="integration-product-name"><h3>PaperLab</h3></div>
            <p>Đọc bài báo, trích xuất thông tin và phân tích tài liệu nghiên cứu.</p>
          </li>
          <li className="integration-product" data-reveal="up">
            <div className="integration-product-name"><h3>Writing Lab</h3></div>
            <p>Soạn thảo và phát triển bản thảo học thuật.</p>
          </li>
        </ul>
      </section>

      <section className="login-trust" id="trust" aria-labelledby="trust-title">
        <div className="trust-intro" data-reveal="left"><p className="eyebrow">TRUY CẬP CÓ KIỂM SOÁT</p><h2 id="trust-title">Cộng tác thuận tiện, quyền truy cập vẫn rõ ràng.</h2><p>Research Hub dùng tài khoản tổ chức và quyền theo project để mỗi thành viên truy cập đúng không gian được chia sẻ với mình.</p></div>
        <div className="trust-points">
          <article data-reveal="up"><span>01</span><div><h3>Đăng nhập bằng SSO</h3><p>Xác thực qua HyperDataLab; chỉ tài khoản tổ chức đã xác minh mới được sử dụng.</p></div></article>
          <article data-reveal="up"><span>02</span><div><h3>Quyền theo vai trò</h3><p>Owner quản lý project và thành viên; member cộng tác với tài liệu và công cụ trong project được chia sẻ.</p></div></article>
          <article data-reveal="up"><span>03</span><div><h3>Tệp gắn với project</h3><p>File không bị xóa khi project được đưa vào lưu trữ; owner có thể khôi phục project sau này.</p></div></article>
        </div>
      </section>

      <section className="login-faq" id="faq" aria-labelledby="faq-title">
        <header className="faq-heading" data-reveal="up">
          <p className="eyebrow">THÔNG TIN SỬ DỤNG</p>
          <h2 id="faq-title">Một vài điều cần biết khi làm việc theo project.</h2>
          <p>Các nguyên tắc về thành viên, tài liệu và công cụ để nhóm bắt đầu đúng cách.</p>
        </header>
        <div className="faq-grid">
          <article className="faq-item" data-reveal="up">
            <h3>Ai có thể được mời vào project?</h3>
            <p>Owner có thể thêm tài khoản HyperDataLab đã xác minh email và từng đăng nhập Research Hub. Member được truy cập file, công cụ trong project được chia sẻ; owner quản lý danh sách thành viên.</p>
          </article>
          <article className="faq-item" data-reveal="up">
            <h3>Mỗi file được gắn với project thế nào?</h3>
            <p>Khi tải lên, chọn project đang hoạt động trước. Mỗi file thuộc một project; thư viện Tệp của bạn cho phép lọc theo project và gắn file cũ chưa phân loại vào project phù hợp.</p>
          </article>
          <article className="faq-item" data-reveal="up">
            <h3>Lưu trữ project có xóa tài liệu không?</h3>
            <p>Không. Project được ẩn khỏi danh sách đang hoạt động, còn file vẫn được giữ. Owner có thể mở mục Lưu trữ để khôi phục project và tiếp tục sử dụng.</p>
          </article>
          <article className="faq-item" data-reveal="up">
            <h3>PaperLab và Writing Lab giữ ngữ cảnh ra sao?</h3>
            <p>Quản trị viên cấu hình địa chỉ dùng chung cho từng công cụ. Khi mở từ workspace, Research Hub chuyển kèm Project ID để công cụ nhận biết project đang làm việc.</p>
          </article>
        </div>
      </section>

      <footer className="login-contact" data-reveal="up">
        <div><p className="eyebrow">CẦN HỖ TRỢ TRUY CẬP?</p><h2>Research Hub dành cho thành viên HyperDataLab.</h2><p>Nếu tài khoản chưa được cấp quyền hoặc email chưa xác minh, hãy liên hệ quản trị viên tổ chức.</p></div>
        <a href="#login-access">Đăng nhập bằng SSO <span aria-hidden="true">↑</span></a>
      </footer>
    </section>
  );
}

function NavIcon({ kind }: { kind: "projects" | "files" }) {
  return kind === "projects" ? (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2" /><path d="M7 7h6M7 10h6M7 13h3" /></svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.75h7l3 3v11.5H5z" /><path d="M12 2.75v3h3M8 10h4m-4 3h4" /></svg>
  );
}

function SettingsIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.1 2.9h3.8l.45 1.7a5.8 5.8 0 0 1 1.2.7l1.7-.45 1.9 3.3-1.25 1.25a5.8 5.8 0 0 1 0 1.4l1.25 1.25-1.9 3.3-1.7-.45a5.8 5.8 0 0 1-1.2.7l-.45 1.7H8.1l-.45-1.7a5.8 5.8 0 0 1-1.2-.7l-1.7.45-1.9-3.3 1.25-1.25a5.8 5.8 0 0 1 0-1.4L2.85 8.15l1.9-3.3 1.7.45a5.8 5.8 0 0 1 1.2-.7L8.1 2.9Z" /><circle cx="10" cy="10" r="2.2" /></svg>;
}

export function ResearchHubShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isProjectsRoute = pathname.startsWith("/projects");
  const isAdminToolsRoute = pathname === "/admin/tools";
  const sessionRaw = useSyncExternalStore(subscribeSsoSession, getSsoSessionRaw, () => null);
  const session = useMemo(() => parseSsoSession(sessionRaw), [sessionRaw]);
  const accessToken = session?.accessToken;
  const isAdmin = isSsoAdminRole(session?.profile.role);

  useEffect(() => {
    hydrateSsoSessionFromCallback();
    if (!pathname.includes("/auth/callback")) logPendingSsoUserInfoDiagnostics();
  }, [pathname]);

  useEffect(() => startSsoSessionAutoRefresh(), []);

  useEffect(() => {
    if (!accessToken) return;
    void registerResearchHubUser(accessToken).catch(() => {
      console.warn("[Research Hub] Could not register the signed-in account for project collaboration.");
    });
  }, [accessToken]);

  async function handleSignOut() {
    await endSsoSession(session);
    clearFileStore();
  }

  if (!session) {
    return (
      <main className="app-shell">
        <BrandHeader actions={
          <nav className="public-nav" aria-label="Điều hướng landing page">
            <a href="#capabilities">Tính năng</a>
            <a href="#workflow">Quy trình</a>
            <a href="#integrations">Công cụ</a>
            <a href="#trust">Quyền truy cập</a>
            <a href="#faq">Giải đáp</a>
            <a className="public-nav-login" href="#login-access">Đăng nhập <span aria-hidden="true">↗</span></a>
          </nav>
        } />
        <LoginPage />
      </main>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <main className="app-shell hub-app-shell">
        <BrandHeader actions={
          <>
            <div className="account-summary">
              <span className="connection"><i /> Tài khoản tổ chức</span>
              <span className="account-email">{session.profile.email}</span>
            </div>
            <button className="signout-button" onClick={() => void handleSignOut()} title={`Đăng xuất ${session.profile.email}`}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3.5H4.5v13H8m3-3 3.5-3.5L11 6.5M7 10h8" /></svg>
              <span>Đăng xuất</span>
            </button>
          </>
        } />
        <div className="hub-layout">
          <aside className="hub-sidebar" aria-label="Điều hướng Research Hub">
            <p className="hub-sidebar-label">KHÔNG GIAN LÀM VIỆC</p>
            <nav className="hub-nav">
              <Link className={`hub-nav-link${isProjectsRoute ? " is-active" : ""}`} href="/projects" aria-current={isProjectsRoute ? "page" : undefined}>
                <NavIcon kind="projects" /> <span>Dự án</span>
              </Link>
              <Link className={`hub-nav-link${pathname === "/files" ? " is-active" : ""}`} href="/files" aria-current={pathname === "/files" ? "page" : undefined}>
                <NavIcon kind="files" /> <span>Tệp của bạn</span>
              </Link>
              {isAdmin && (
                <Link className={`hub-nav-link${isAdminToolsRoute ? " is-active" : ""}`} href="/admin/tools" aria-current={isAdminToolsRoute ? "page" : undefined}>
                  <SettingsIcon /> <span>Cấu hình</span>
                </Link>
              )}
            </nav>
          </aside>
          <div className="hub-main">{children}</div>
        </div>
      </main>
    </SessionContext.Provider>
  );
}

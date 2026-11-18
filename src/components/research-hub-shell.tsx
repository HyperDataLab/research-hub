"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandHeader } from "@/components/brand-header";
import { clearFileStore } from "@/lib/file-store";
import {
  endSsoSession,
  getSsoConfigurationIssues,
  getSsoSessionRaw,
  hydrateSsoSessionFromCallback,
  isSsoConfigured,
  parseSsoSession,
  startSsoLogin,
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
      <header className="login-heading">
        <h1>Kho tài liệu nghiên cứu</h1>
        <p>Kho lưu trữ tài liệu nội bộ dành cho thành viên HyperDataLab.</p>
      </header>
      <div className="login-columns">
        <section className="login-information" aria-label="Thông tin về kho tài liệu">
          <section className="login-info-section" aria-labelledby="library-heading">
            <h2 id="library-heading">Tài liệu trong kho</h2>
            <p>Kho lưu các tệp nghiên cứu do thành viên tải lên. Thành viên có thể tìm, tải xuống hoặc xóa các tệp trong thư viện riêng của tài khoản.</p>
          </section>
          <section className="login-info-section login-support" aria-labelledby="support-heading">
            <h2 id="support-heading">Hỗ trợ truy cập</h2>
            <p>Nếu chưa có tài khoản tổ chức, hãy liên hệ quản trị viên HyperDataLab để được cấp quyền. Nếu đăng nhập gặp lỗi, hãy kiểm tra email tổ chức đã được xác minh rồi thử lại SSO.</p>
          </section>
        </section>
        <section className="login-card" aria-labelledby="login-card-title">
          <h2 id="login-card-title">Đăng nhập vào Research Hub</h2>
          <p className="login-note">Sử dụng tài khoản tổ chức có email <strong>@hyperdatalab.org</strong> đã xác minh.</p>
          <button className="sso-button" onClick={() => void handleSignIn()} disabled={!isSsoConfigured || loginBusy} aria-busy={loginBusy}>
            {loginBusy ? <><span className="spinner" /> Đang chuyển tới SSO</> : <>Tiếp tục với HyperDataLab SSO <span>↗</span></>}
          </button>
          {!isSsoConfigured && <p className="config-hint">Đăng nhập SSO hiện chưa sẵn sàng. Vui lòng thử lại sau.</p>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
        </section>
      </div>
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

export function ResearchHubShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isProjectsRoute = pathname.startsWith("/projects");
  const sessionRaw = useSyncExternalStore(subscribeSsoSession, getSsoSessionRaw, () => null);
  const session = useMemo(() => parseSsoSession(sessionRaw), [sessionRaw]);

  useEffect(() => {
    hydrateSsoSessionFromCallback();
  }, []);

  async function handleSignOut() {
    await endSsoSession(session);
    clearFileStore();
  }

  if (!session) {
    return (
      <main className="app-shell">
        <BrandHeader />
        <LoginPage />
      </main>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <main className="app-shell hub-app-shell">
        <BrandHeader actions={
          <>
            <span className="connection"><i /> Tài khoản tổ chức</span>
            <span className="account-email">{session.profile.email}</span>
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
            </nav>
          </aside>
          <div className="hub-main">{children}</div>
        </div>
      </main>
    </SessionContext.Provider>
  );
}

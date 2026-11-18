"use client";

import { useEffect, useRef, useState } from "react";
import { startSsoLogin, completeSsoCallback } from "@/lib/sso";
import { BrandHeader } from "@/components/brand-header";

export default function SsoCallbackPage() {
  const [error, setError] = useState("");
  const callbackStarted = useRef(false);

  useEffect(() => {
    if (callbackStarted.current) return;
    callbackStarted.current = true;
    let active = true;
    const callbackUrl = window.location.href;
    window.history.replaceState({}, document.title, "/auth/callback");
    void completeSsoCallback(callbackUrl)
      .then(() => window.location.replace("/"))
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Đăng nhập SSO thất bại.");
      });
    return () => { active = false; };
  }, []);

  return (
    <main className="app-shell">
      <BrandHeader />
      <section className="workspace callback-workspace">
        <section className="login-panel callback-panel">
          <div className="upload-icon"><span className={error ? "callback-error-icon" : "spinner"}>{error ? "!" : ""}</span></div>
          <p className="eyebrow">HYPERDATALAB SSO</p>
          <h2>{error ? "Không thể đăng nhập" : "Đang xác minh tài khoản"}</h2>
          <p>{error || "Đang kiểm tra tài khoản tổ chức của bạn…"}</p>
          {error && <button className="sso-button" onClick={() => void startSsoLogin()}>Thử đăng nhập lại <span>↗</span></button>}
        </section>
      </section>
    </main>
  );
}

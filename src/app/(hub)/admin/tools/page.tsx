"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useResearchHubSession } from "@/components/research-hub-shell";
import { getToolSettings, saveToolSettings, type ToolSettings } from "@/lib/tool-settings";
import { isSsoAdminRole } from "@/lib/sso";

const EMPTY_SETTINGS: ToolSettings = { paperLabUrl: "", writingLabUrl: "" };

export default function AdminToolSettingsPage() {
  const session = useResearchHubSession();
  const isAdmin = isSsoAdminRole(session.profile.role);
  const [settings, setSettings] = useState<ToolSettings>(EMPTY_SETTINGS);
  const [loadState, setLoadState] = useState<{ accessToken: string; error: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void getToolSettings(session.accessToken)
      .then((value) => {
        if (active) {
          setSettings(value);
          setLoadState({ accessToken: session.accessToken, error: "" });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setLoadState({
            accessToken: session.accessToken,
            error: cause instanceof Error ? cause.message : "Không tải được cấu hình công cụ.",
          });
        }
      });
    return () => { active = false; };
  }, [isAdmin, session.accessToken]);

  const currentLoadState = loadState?.accessToken === session.accessToken ? loadState : null;
  const loading = isAdmin && !currentLoadState;
  const loadingError = currentLoadState?.error ?? "";

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || !isAdmin) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const value = await saveToolSettings(session.accessToken, settings);
      setSettings(value);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Không lưu được cấu hình công cụ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hub-page-content" aria-busy={loading || saving}>
      <header className="hub-page-heading">
        <p className="eyebrow">QUẢN TRỊ</p>
        <h1>Cấu hình công cụ</h1>
        <p className="intro-copy">Quản lý địa chỉ PaperLab và Writing Lab dùng chung cho các workspace dự án.</p>
      </header>

      {!isAdmin ? (
        <div className="notice notice-error" role="alert">Bạn cần tài khoản có role admin để quản lý cấu hình này.</div>
      ) : (
        <>
          {(loadingError || saveError) && <div className="notice notice-error" role="alert">{loadingError || saveError}</div>}
          {saved && <div className="notice notice-success" role="status">Đã lưu cấu hình công cụ.</div>}
          {loading ? (
            <div className="project-empty" role="status"><span className="spinner" /><p>Đang tải cấu hình…</p></div>
          ) : !loadingError && (
            <form className="project-form tool-settings-form" onSubmit={(event) => void handleSave(event)}>
              <label htmlFor="paper-lab-url">PaperLab URL</label>
              <input
                id="paper-lab-url"
                name="paperLabUrl"
                type="url"
                inputMode="url"
                maxLength={2048}
                placeholder="https://paperlab.example.org"
                value={settings.paperLabUrl}
                onChange={(event) => { setSettings((current) => ({ ...current, paperLabUrl: event.target.value })); setSaved(false); }}
                disabled={saving}
              />

              <label htmlFor="writing-lab-url">Writing Lab URL</label>
              <input
                id="writing-lab-url"
                name="writingLabUrl"
                type="url"
                inputMode="url"
                maxLength={2048}
                placeholder="https://writing-lab.example.org"
                value={settings.writingLabUrl}
                onChange={(event) => { setSettings((current) => ({ ...current, writingLabUrl: event.target.value })); setSaved(false); }}
                disabled={saving}
              />

              <p className="tool-settings-help">Nhập URL gốc. Research Hub sẽ tự thêm mã dự án vào liên kết. Để ngắt kết nối một công cụ, hãy để trống URL của công cụ đó.</p>
              <div className="project-form-actions">
                <button className="project-create-button" type="submit" disabled={saving || loading}>
                  {saving ? <><span className="spinner" /> Đang lưu</> : "Lưu cấu hình"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

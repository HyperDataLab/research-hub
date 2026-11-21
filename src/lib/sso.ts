export interface SsoProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  role?: string;
  student_id?: string;
  major?: string;
}

export interface SsoSession {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  profile: SsoProfile;
}

interface SsoAttempt {
  state: string;
  verifier: string;
  createdAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

const SESSION_TRANSFER_KEY = "research-hub-sso-session-transfer";
const SESSION_KEY = "research-hub-sso-session";
const ATTEMPT_KEY = "research-hub-sso-attempt";
const SESSION_EVENT = "research-hub-sso-session-change";
const SSO_USERINFO_DIAGNOSTICS_KEY = "research-hub-sso-userinfo-diagnostics";
const SSO_BASE_URL = (process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_BASE_URL ?? "").replace(/\/$/, "");
const CLIENT_ID = process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_CLIENT_ID ?? "";
const CALLBACK_URL = process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_CALLBACK_URL ?? "";
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const REFRESH_RETRY_MS = 30 * 1000;
let sessionRawInMemory: string | null = null;
let refreshInFlight: Promise<SsoSession | null> | null = null;
let sessionRevision = 0;

export function getSsoConfigurationIssues(): string[] {
  const issues: string[] = [];
  if (!SSO_BASE_URL) issues.push("NEXT_PUBLIC_HYPERDATALAB_SSO_BASE_URL is missing");
  if (!CLIENT_ID) issues.push("NEXT_PUBLIC_HYPERDATALAB_SSO_CLIENT_ID is missing");
  else if (CLIENT_ID.startsWith("replace-")) issues.push("NEXT_PUBLIC_HYPERDATALAB_SSO_CLIENT_ID is still a placeholder");
  if (!CALLBACK_URL) issues.push("NEXT_PUBLIC_HYPERDATALAB_SSO_CALLBACK_URL is missing");
  return issues;
}

export const isSsoConfigured = getSsoConfigurationIssues().length === 0;

export function getSsoSessionRaw(): string | null {
  if (sessionRawInMemory) return sessionRawInMemory;
  if (typeof window === "undefined") return null;

  const transferred = window.sessionStorage.getItem(SESSION_TRANSFER_KEY);
  const stored = transferred ?? window.sessionStorage.getItem(SESSION_KEY);
  if (!parseSsoSession(stored)) {
    window.sessionStorage.removeItem(SESSION_TRANSFER_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  }

  sessionRawInMemory = stored;
  if (transferred) {
    window.sessionStorage.setItem(SESSION_KEY, transferred);
    window.sessionStorage.removeItem(SESSION_TRANSFER_KEY);
  }
  return sessionRawInMemory;
}

export function hydrateSsoSessionFromCallback() {
  if (!getSsoSessionRaw()) return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function parseSsoSession(raw: string | null): SsoSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as SsoSession;
    const hasValidRefreshToken = Boolean(session.refreshToken && session.refreshExpiresAt && session.refreshExpiresAt > Date.now());
    if (!session.accessToken || (session.expiresAt <= Date.now() && !hasValidRefreshToken)) return null;
    if (!session.profile?.sub || !isAllowedOrganizationEmail(session.profile.email, session.profile.email_verified)) return null;
    return session;
  } catch {
    return null;
  }
}

export function subscribeSsoSession(callback: () => void): () => void {
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function isAllowedOrganizationEmail(email: unknown, verified: unknown): email is string {
  return verified === true && typeof email === "string" && /^[^@\s]+@hyperdatalab\.org$/i.test(email.trim());
}

export function isSsoAdminRole(role: unknown): boolean {
  return typeof role === "string" && role.trim().toLowerCase() === "admin";
}

export function logPendingSsoUserInfoDiagnostics(): void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return;
  const diagnostics = window.sessionStorage.getItem(SSO_USERINFO_DIAGNOSTICS_KEY);
  if (!diagnostics) return;
  window.sessionStorage.removeItem(SSO_USERINFO_DIAGNOSTICS_KEY);
  try {
    console.info("[Research Hub] SSO userinfo diagnostics", JSON.parse(diagnostics));
  } catch {
    console.warn("[Research Hub] Could not read saved SSO userinfo diagnostics.");
  }
}

function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function saveSsoSession(session: SsoSession): void {
  const raw = JSON.stringify(session);
  sessionRawInMemory = raw;
  window.sessionStorage.setItem(SESSION_KEY, raw);
  window.sessionStorage.removeItem(SESSION_TRANSFER_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function clearLocalSsoSession(): void {
  sessionRevision += 1;
  sessionRawInMemory = null;
  window.sessionStorage.removeItem(SESSION_TRANSFER_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function tokenErrorCode(body: TokenResponse): string {
  if (typeof body.error === "string") return body.error;
  return (body as unknown as { error?: { code?: string } }).error?.code ?? "";
}

export async function refreshSsoSessionIfNeeded(): Promise<SsoSession | null> {
  const session = parseSsoSession(getSsoSessionRaw());
  if (!session) return null;
  if (session.expiresAt > Date.now() + REFRESH_BEFORE_EXPIRY_MS) return session;

  if (!session.refreshToken || !session.refreshExpiresAt || session.refreshExpiresAt <= Date.now()) {
    if (session.expiresAt <= Date.now()) clearLocalSsoSession();
    return session.expiresAt > Date.now() ? session : null;
  }
  if (refreshInFlight) return refreshInFlight;

  const revisionAtStart = sessionRevision;
  refreshInFlight = (async () => {
    const response = await fetch(new URL("/oauth/token", SSO_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: session.refreshToken!,
      }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok || !body.access_token || !body.refresh_token) {
      if (["INVALID_GRANT", "INVALID_CLIENT"].includes(tokenErrorCode(body))) clearLocalSsoSession();
      throw new Error(body.error_description ?? body.error ?? "Không thể gia hạn phiên SSO.");
    }
    if (revisionAtStart !== sessionRevision) return parseSsoSession(getSsoSessionRaw());

    const nextSession: SsoSession = {
      ...session,
      accessToken: body.access_token,
      expiresAt: Date.now() + Math.max(0, body.expires_in ?? 3600) * 1000,
      refreshToken: body.refresh_token,
      refreshExpiresAt: Date.now() + Math.max(0, body.refresh_token_expires_in ?? 0) * 1000,
    };
    if (!nextSession.refreshExpiresAt || nextSession.refreshExpiresAt <= Date.now()) {
      clearLocalSsoSession();
      throw new Error("Refresh token SSO đã hết hạn. Vui lòng đăng nhập lại.");
    }
    saveSsoSession(nextSession);
    return nextSession;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function startSsoSessionAutoRefresh(): () => void {
  if (typeof window === "undefined") return () => {};

  let timer: number | undefined;
  let stopped = false;
  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    const session = parseSsoSession(getSsoSessionRaw());
    if (!session) return;
    const delay = Math.max(0, session.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    timer = window.setTimeout(() => {
      timer = undefined;
      if (document.visibilityState === "visible") void refresh();
    }, delay);
  };
  const refresh = async () => {
    try {
      await refreshSsoSessionIfNeeded();
      if (stopped) return;
      schedule();
    } catch (error) {
      if (stopped || !parseSsoSession(getSsoSessionRaw())) return;
      console.warn("[Research Hub] SSO session refresh failed; retrying shortly.", error instanceof Error ? error.message : "Unknown error");
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, REFRESH_RETRY_MS);
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  const unsubscribe = subscribeSsoSession(schedule);
  window.addEventListener("focus", onVisibilityChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule();

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("focus", onVisibilityChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export async function startSsoLogin(): Promise<void> {
  if (!isSsoConfigured) throw new Error("Chưa cấu hình SSO client_id hoặc callback URL.");
  const state = randomBase64Url();
  const verifier = randomBase64Url();
  const challenge = await createCodeChallenge(verifier);
  const attempt: SsoAttempt = { state, verifier, createdAt: Date.now() };
  window.sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));

  const authorizeUrl = new URL("/oauth/authorize", SSO_BASE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: "email profile hyperdatalab_profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(authorizeUrl.toString());
}

export async function completeSsoCallback(callbackUrl: string): Promise<void> {
  const callback = new URL(callbackUrl);
  const providerError = callback.searchParams.get("error_description") ?? callback.searchParams.get("error");
  if (providerError) {
    window.sessionStorage.removeItem(ATTEMPT_KEY);
    throw new Error(providerError);
  }

  const code = callback.searchParams.get("code");
  const returnedState = callback.searchParams.get("state");
  const rawAttempt = window.sessionStorage.getItem(ATTEMPT_KEY);
  window.sessionStorage.removeItem(ATTEMPT_KEY);
  if (!rawAttempt || !code || !returnedState) throw new Error("Phiên SSO không hợp lệ. Hãy bắt đầu đăng nhập lại.");

  const attempt = JSON.parse(rawAttempt) as SsoAttempt;
  if (attempt.state !== returnedState || Date.now() - attempt.createdAt < 0 || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
    throw new Error("State SSO không khớp hoặc đã hết hạn. Hãy bắt đầu đăng nhập lại.");
  }

  const tokenResponse = await fetch(new URL("/oauth/token", SSO_BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: CALLBACK_URL,
      code_verifier: attempt.verifier,
    }),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({})) as TokenResponse;
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description ?? tokenBody.error ?? "Không đổi được mã đăng nhập SSO.");
  }

  const userInfoResponse = await fetch(new URL("/oauth/userinfo", SSO_BASE_URL), {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = await userInfoResponse.json().catch(() => ({})) as SsoProfile;
  if (process.env.NODE_ENV === "development") {
    const diagnostics = {
      status: userInfoResponse.status,
      claims: Object.keys(profile).sort(),
      role: profile.role ?? null,
    };
    window.sessionStorage.setItem(SSO_USERINFO_DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
  }
  if (!userInfoResponse.ok || !profile.sub) throw new Error("Không lấy được hồ sơ từ HyperDataLab SSO.");
  if (!isAllowedOrganizationEmail(profile.email, profile.email_verified)) {
    await fetch(new URL("/oauth/revoke", SSO_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenBody.refresh_token ?? tokenBody.access_token }),
    }).catch(() => undefined);
    throw new Error("Chỉ chấp nhận tài khoản email đã xác minh thuộc @hyperdatalab.org.");
  }

  const session: SsoSession = {
    accessToken: tokenBody.access_token,
    expiresAt: Date.now() + Math.max(0, tokenBody.expires_in ?? 3600) * 1000,
    ...(tokenBody.refresh_token ? { refreshToken: tokenBody.refresh_token } : {}),
    ...(tokenBody.refresh_token_expires_in !== undefined
      ? { refreshExpiresAt: Date.now() + Math.max(0, tokenBody.refresh_token_expires_in) * 1000 }
      : {}),
    profile,
  };
  sessionRevision += 1;
  sessionRawInMemory = null;
  window.sessionStorage.setItem(SESSION_TRANSFER_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export async function endSsoSession(session: SsoSession | null): Promise<void> {
  const token = session?.refreshToken ?? session?.accessToken;
  if (token && SSO_BASE_URL) {
    await fetch(new URL("/oauth/revoke", SSO_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }
  clearLocalSsoSession();
}

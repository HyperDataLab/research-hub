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
  error?: string;
  error_description?: string;
}

const SESSION_TRANSFER_KEY = "research-hub-sso-session-transfer";
const SESSION_KEY = "research-hub-sso-session";
const ATTEMPT_KEY = "research-hub-sso-attempt";
const SESSION_EVENT = "research-hub-sso-session-change";
const SSO_BASE_URL = (process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_BASE_URL ?? "").replace(/\/$/, "");
const CLIENT_ID = process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_CLIENT_ID ?? "";
const CALLBACK_URL = process.env.NEXT_PUBLIC_HYPERDATALAB_SSO_CALLBACK_URL ?? "";
let sessionRawInMemory: string | null = null;

export const isSsoConfigured = Boolean(
  SSO_BASE_URL && CLIENT_ID && !CLIENT_ID.startsWith("replace-") && CALLBACK_URL,
);

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
    if (!session.accessToken || session.expiresAt <= Date.now()) return null;
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
    scope: "email profile",
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
  if (!userInfoResponse.ok || !profile.sub) throw new Error("Không lấy được hồ sơ từ HyperDataLab SSO.");
  if (!isAllowedOrganizationEmail(profile.email, profile.email_verified)) {
    await fetch(new URL("/oauth/revoke", SSO_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenBody.access_token }),
    }).catch(() => undefined);
    throw new Error("Chỉ chấp nhận tài khoản email đã xác minh thuộc @hyperdatalab.org.");
  }

  const session: SsoSession = {
    accessToken: tokenBody.access_token,
    expiresAt: Date.now() + Math.max(0, tokenBody.expires_in ?? 3600) * 1000,
    profile,
  };
  window.sessionStorage.setItem(SESSION_TRANSFER_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export async function endSsoSession(session: SsoSession | null): Promise<void> {
  if (session?.accessToken && SSO_BASE_URL) {
    await fetch(new URL("/oauth/revoke", SSO_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.accessToken }),
    }).catch(() => undefined);
  }
  sessionRawInMemory = null;
  window.sessionStorage.removeItem(SESSION_TRANSFER_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

interface Env {
  FILES_BUCKET: R2Bucket;
  SSO_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
}

interface SsoUserInfo {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectInput {
  name: string;
  description: string;
}

class AuthFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class FirestoreFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const LIST_LIMIT = 100;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, { stringValue?: string; timestampValue?: string }>;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function pemBytes(pem: string): Uint8Array {
  const encoded = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getFirestoreToken(env: Env): Promise<string> {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.value;
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
    throw new FirestoreFailure("Worker chưa được cấu hình thông tin kết nối Firestore.", 503);
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FIRESTORE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey("pkcs8", arrayBuffer(pemBytes(env.FIREBASE_PRIVATE_KEY)), {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    }, false, ["sign"]);
  } catch {
    throw new FirestoreFailure("Khóa service account của Firebase không hợp lệ.", 503);
  }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, arrayBuffer(new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
  } catch {
    throw new FirestoreFailure("Không thể kết nối dịch vụ xác thực Google.", 502);
  }
  if (!response.ok) throw new FirestoreFailure("Google từ chối service account của Firebase.", 503);
  const result = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof result.access_token !== "string") throw new FirestoreFailure("Google trả về access token không hợp lệ.", 502);
  const expiresIn = typeof result.expires_in === "number" ? result.expires_in : 3600;
  cachedGoogleToken = { value: result.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return result.access_token;
}

async function firestoreRequest<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const token = await getFirestoreToken(env);
  let response: Response;
  try {
    response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new FirestoreFailure("Không thể kết nối Cloud Firestore.", 502);
  }
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 503 : 502;
    throw new FirestoreFailure("Yêu cầu Cloud Firestore thất bại. Kiểm tra quyền IAM của service account và cấu hình database.", status);
  }
  return await response.json() as T;
}

function firestoreString(document: FirestoreDocument, field: string): string {
  const value = document.fields?.[field]?.stringValue;
  return typeof value === "string" ? value : "";
}

function projectFromDocument(document: FirestoreDocument, ownerSub: string): ProjectRow | null {
  const fields = document.fields;
  const actualOwner = firestoreString(document, "ownerSub");
  const id = document.name?.split("/").at(-1);
  const createdAt = fields?.createdAt?.timestampValue;
  const updatedAt = fields?.updatedAt?.timestampValue;
  if (actualOwner !== ownerSub || !id || !createdAt || !updatedAt) return null;
  return {
    id,
    name: firestoreString(document, "name"),
    description: firestoreString(document, "description"),
    createdAt,
    updatedAt,
  };
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data: unknown, status: number, headers: Headers): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

async function getUid(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new AuthFailure("A HyperDataLab SSO access token is required.", 401);

  let response: Response;
  try {
    response = await fetch(new URL("/oauth/userinfo", env.SSO_BASE_URL), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AuthFailure("HyperDataLab SSO is unavailable.", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthFailure("The SSO access token is invalid or expired.", 401);
  }
  if (!response.ok) throw new AuthFailure("Could not verify the SSO access token.", 502);

  const profile = await response.json() as SsoUserInfo;
  const allowedEmail = typeof profile.email === "string" &&
    /^[^@\s]+@hyperdatalab\.org$/i.test(profile.email.trim()) &&
    profile.email_verified === true;
  if (!allowedEmail) throw new AuthFailure("Only verified @hyperdatalab.org accounts are allowed.", 403);
  if (typeof profile.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.sub)) {
    throw new AuthFailure("The SSO profile has no stable subject identifier.", 401);
  }
  return profile.sub;
}

async function readProjectInput(request: Request): Promise<ProjectInput | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "name" && key !== "description")) return null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description === undefined
    ? ""
    : typeof body.description === "string" ? body.description.trim() : null;
  if (!name || name.length > 120 || description === null || description.length > 1000) return null;
  return { name, description };
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/\r\n\0]/g, "_").trim().slice(0, 180);
  return cleaned || "download";
}

function attachmentHeader(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (!env.SSO_BASE_URL || env.SSO_BASE_URL.startsWith("replace-")) {
    return json({ error: "Configure SSO_BASE_URL in worker/wrangler.jsonc." }, 503, headers);
  }

  let uid: string;
  try {
    uid = await getUid(request, env);
  } catch (error) {
    if (error instanceof AuthFailure) return json({ error: error.message }, error.status, headers);
    throw error;
  }

  if (url.pathname === "/api/projects" && request.method === "GET") {
    const result = await firestoreRequest<Array<{ document?: FirestoreDocument }>>(env, ":runQuery", {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "projects" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "ownerSub" },
              op: "EQUAL",
              value: { stringValue: uid },
            },
          },
          limit: LIST_LIMIT,
        },
      }),
    });
    const items = result.flatMap((row) => row.document ? [projectFromDocument(row.document, uid)].filter((project): project is ProjectRow => project !== null) : []);
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return json({ items }, 200, headers);
  }

  if (url.pathname === "/api/projects" && request.method === "POST") {
    const input = await readProjectInput(request);
    if (!input) {
      return json({ error: "Project name and description are invalid." }, 400, headers);
    }
    const now = new Date().toISOString();
    const project: ProjectRow = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    await firestoreRequest<FirestoreDocument>(env, `/projects?documentId=${encodeURIComponent(project.id)}`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          ownerSub: { stringValue: uid },
          name: { stringValue: project.name },
          description: { stringValue: project.description },
          createdAt: { timestampValue: project.createdAt },
          updatedAt: { timestampValue: project.updatedAt },
        },
      }),
    });
    return json({ project }, 201, headers);
  }

  if (url.pathname === "/api/files" && request.method === "GET") {
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const listed = await env.FILES_BUCKET.list({ prefix: `${uid}/`, cursor, limit: LIST_LIMIT });
    const items = listed.objects.map((object) => ({
      id: object.key.slice(uid.length + 1),
      name: object.customMetadata?.originalName ?? "download",
      contentType: object.customMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
    }));
    return json({ items, cursor: listed.truncated ? listed.cursor : null }, 200, headers);
  }

  if (url.pathname === "/api/files" && request.method === "POST") {
    const headerName = request.headers.get("X-File-Name");
    if (!headerName) return json({ error: "X-File-Name header is required." }, 400, headers);
    let suppliedName = headerName;
    try { suppliedName = decodeURIComponent(suppliedName); } catch { /* Keep the supplied value; safeFileName removes path characters. */ }
    const name = safeFileName(suppliedName);
    const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (!request.body) return json({ error: "File content is required." }, 400, headers);
    if (contentLength > MAX_FILE_SIZE) return json({ error: "Maximum file size is 25 MB." }, 413, headers);

    const id = crypto.randomUUID();
    let size = 0;
    const guardedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_FILE_SIZE) throw new Error("FILE_TOO_LARGE");
        controller.enqueue(chunk);
      },
    }));

    try {
      const stored = await env.FILES_BUCKET.put(`${uid}/${id}`, guardedBody, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { originalName: name, contentType: contentType.slice(0, 120) },
      });
      return json({
        item: { id, name, contentType, size: stored.size, uploadedAt: stored.uploaded.toISOString() },
      }, 201, headers);
    } catch (error) {
      if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
        return json({ error: "Maximum file size is 25 MB." }, 413, headers);
      }
      throw error;
    }
  }

  const match = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (match) {
    const key = `${uid}/${match[1]}`;
    if (request.method === "GET") {
      const object = await env.FILES_BUCKET.get(key);
      if (!object) return json({ error: "File not found." }, 404, headers);
      const fileName = safeFileName(object.customMetadata?.originalName ?? "download");
      const downloadHeaders = new Headers(headers);
      object.writeHttpMetadata(downloadHeaders);
      downloadHeaders.set("Content-Type", "application/octet-stream");
      downloadHeaders.set("Content-Disposition", attachmentHeader(fileName));
      downloadHeaders.set("X-Content-Type-Options", "nosniff");
      downloadHeaders.set("Cache-Control", "private, no-store");
      if (object.httpEtag) downloadHeaders.set("ETag", object.httpEtag);
      return new Response(object.body, { headers: downloadHeaders });
    }
    if (request.method === "DELETE") {
      await env.FILES_BUCKET.delete(key);
      return json({ ok: true }, 200, headers);
    }
  }

  return json({ error: "Not found." }, 404, headers);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const headers = corsHeaders(request, env);
    if (origin && !allowedOrigins.includes(origin)) {
      return new Response("Origin is not allowed.", { status: 403 });
    }
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof FirestoreFailure) return json({ error: error.message }, error.status, headers);
      console.error("Request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Request failed." }, 500, headers);
    }
  },
};

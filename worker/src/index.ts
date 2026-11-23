interface Env {
  FILES_BUCKET: R2Bucket;
  SSO_GATEWAY?: Fetcher;
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
  name?: unknown;
  role?: unknown;
}

interface SsoIdentity {
  sub: string;
  email: string;
  name: string;
  role: string | null;
}

interface ToolSettings {
  paperLabUrl: string;
  writingLabUrl: string;
}

interface ProjectMember {
  sub: string;
  email: string;
  name: string;
  addedAt: string;
}

interface ProjectRow {
  id: string;
  updateTime: string | null;
  ownerSub: string;
  ownerEmail: string;
  accessRole: "owner" | "member";
  members: ProjectMember[];
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
const TOOL_SETTINGS_PATH = "/toolSettings/global";
const EMPTY_TOOL_SETTINGS: ToolSettings = { paperLabUrl: "", writingLabUrl: "" };
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

interface FirestoreDocument {
  name?: string;
  updateTime?: string;
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreValue {
  stringValue?: string;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
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
    const status = response.status === 401 || response.status === 403 ? 503 : response.status === 404 ? 404 : response.status === 409 ? 409 : 502;
    const message = status === 409
      ? "Project changed while this request was being processed. Refresh and try again."
      : "Yêu cầu Cloud Firestore thất bại. Kiểm tra quyền IAM của service account và cấu hình database.";
    throw new FirestoreFailure(message, status);
  }
  return await response.json() as T;
}

function firestoreString(document: FirestoreDocument, field: string): string {
  const value = document.fields?.[field]?.stringValue;
  return typeof value === "string" ? value : "";
}

function firestoreArray(document: FirestoreDocument, field: string): FirestoreValue[] {
  const values = document.fields?.[field]?.arrayValue?.values;
  return Array.isArray(values) ? values : [];
}

function firestoreMember(value: FirestoreValue): ProjectMember | null {
  const fields = value.mapValue?.fields;
  const sub = fields?.sub?.stringValue;
  const email = fields?.email?.stringValue;
  const name = fields?.name?.stringValue ?? "";
  const addedAt = fields?.addedAt?.timestampValue;
  if (!sub || !email || !addedAt) return null;
  return { sub, email, name, addedAt };
}

function memberValue(member: ProjectMember): FirestoreValue {
  return { mapValue: { fields: {
    sub: { stringValue: member.sub },
    email: { stringValue: member.email },
    name: { stringValue: member.name },
    addedAt: { timestampValue: member.addedAt },
  } } };
}

function projectForClient(project: ProjectRow) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    ownerEmail: project.ownerEmail,
    accessRole: project.accessRole,
    memberCount: project.members.length,
    members: project.accessRole === "owner" ? project.members.map(({ sub, email, name, addedAt }) => ({ id: sub, email, name, addedAt })) : [],
  };
}

function toolSettingsFromDocument(document: FirestoreDocument): ToolSettings {
  return {
    paperLabUrl: firestoreString(document, "paperLabUrl"),
    writingLabUrl: firestoreString(document, "writingLabUrl"),
  };
}

async function getToolSettings(env: Env): Promise<ToolSettings> {
  try {
    const document = await firestoreRequest<FirestoreDocument>(env, TOOL_SETTINGS_PATH);
    return toolSettingsFromDocument(document);
  } catch (error) {
    if (error instanceof FirestoreFailure && error.status === 404) return EMPTY_TOOL_SETTINGS;
    throw error;
  }
}

async function saveToolSettings(env: Env, settings: ToolSettings, updatedBy: string): Promise<ToolSettings> {
  const updateMask = new URLSearchParams();
  for (const field of ["paperLabUrl", "writingLabUrl", "updatedAt", "updatedBy"]) {
    updateMask.append("updateMask.fieldPaths", field);
  }
  const document = await firestoreRequest<FirestoreDocument>(env, `${TOOL_SETTINGS_PATH}?${updateMask.toString()}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        paperLabUrl: { stringValue: settings.paperLabUrl },
        writingLabUrl: { stringValue: settings.writingLabUrl },
        updatedAt: { timestampValue: new Date().toISOString() },
        updatedBy: { stringValue: updatedBy },
      },
    }),
  });
  return toolSettingsFromDocument(document);
}

function projectFromDocument(document: FirestoreDocument, identity: SsoIdentity): ProjectRow | null {
  const fields = document.fields;
  const ownerSub = firestoreString(document, "ownerSub");
  const id = document.name?.split("/").at(-1);
  const createdAt = fields?.createdAt?.timestampValue;
  const updatedAt = fields?.updatedAt?.timestampValue;
  const members = firestoreArray(document, "members").map(firestoreMember).filter((member): member is ProjectMember => member !== null);
  const accessRole = ownerSub === identity.sub ? "owner" : members.some((member) => member.sub === identity.sub) ? "member" : null;
  if (!ownerSub || !id || !createdAt || !updatedAt || !accessRole) return null;
  return {
    id,
    updateTime: document.updateTime ?? null,
    ownerSub,
    ownerEmail: firestoreString(document, "ownerEmail"),
    accessRole,
    members,
    name: firestoreString(document, "name"),
    description: firestoreString(document, "description"),
    createdAt,
    updatedAt,
    deletedAt: fields?.deletedAt?.timestampValue ?? null,
  };
}

async function getProjectDocument(env: Env, id: string): Promise<FirestoreDocument | null> {
  try {
    return await firestoreRequest<FirestoreDocument>(env, `/projects/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof FirestoreFailure && error.status === 404) return null;
    throw error;
  }
}

async function getAccessibleProject(env: Env, id: string, identity: SsoIdentity): Promise<ProjectRow | null> {
  const document = await getProjectDocument(env, id);
  return document ? projectFromDocument(document, identity) : null;
}

async function getOwnedProject(env: Env, id: string, identity: SsoIdentity): Promise<ProjectRow | null> {
  const project = await getAccessibleProject(env, id, identity);
  return project?.accessRole === "owner" ? project : null;
}

async function listProjectsByFilter(env: Env, fieldPath: string, op: "EQUAL" | "ARRAY_CONTAINS", value: FirestoreValue): Promise<FirestoreDocument[]> {
  const result = await firestoreRequest<Array<{ document?: FirestoreDocument }>>(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "projects" }],
      where: { fieldFilter: { field: { fieldPath }, op, value } },
      limit: LIST_LIMIT,
    } }),
  });
  return result.flatMap((row) => row.document ? [row.document] : []);
}

async function listAccessibleProjects(env: Env, identity: SsoIdentity): Promise<ProjectRow[]> {
  const [owned, memberOf] = await Promise.all([
    listProjectsByFilter(env, "ownerSub", "EQUAL", { stringValue: identity.sub }),
    listProjectsByFilter(env, "memberSubs", "ARRAY_CONTAINS", { stringValue: identity.sub }),
  ]);
  const seen = new Set<string>();
  const items = [...owned, ...memberOf].flatMap((document) => {
    const project = projectFromDocument(document, identity);
    if (!project || seen.has(project.id)) return [];
    seen.add(project.id);
    return [project];
  });
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

async function saveProjectMembers(env: Env, projectId: string, members: ProjectMember[], ownerEmail: string, updateTime: string | null): Promise<void> {
  const updateMask = new URLSearchParams();
  for (const field of ["members", "memberSubs", "ownerEmail", "updatedAt"]) updateMask.append("updateMask.fieldPaths", field);
  if (updateTime) updateMask.set("currentDocument.updateTime", updateTime);
  await firestoreRequest<FirestoreDocument>(env, `/projects/${encodeURIComponent(projectId)}?${updateMask.toString()}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: {
      members: { arrayValue: { values: members.map(memberValue) } },
      memberSubs: { arrayValue: { values: members.map((member) => ({ stringValue: member.sub })) } },
      ownerEmail: { stringValue: ownerEmail },
      updatedAt: { timestampValue: new Date().toISOString() },
    } }),
  });
}

async function registerResearchHubUser(env: Env, identity: SsoIdentity): Promise<void> {
  const now = new Date().toISOString();
  await firestoreRequest<FirestoreDocument>(env, `/researchHubUsers/${encodeURIComponent(identity.sub)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: {
      sub: { stringValue: identity.sub },
      email: { stringValue: identity.email },
      name: { stringValue: identity.name },
      lastSeenAt: { timestampValue: now },
    } }),
  });
}

async function findRegisteredUserByEmail(env: Env, email: string): Promise<{ sub: string; email: string; name: string } | null> {
  const result = await firestoreRequest<Array<{ document?: FirestoreDocument }>>(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "researchHubUsers" }],
      where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } },
      limit: 1,
    } }),
  });
  const document = result.find((row) => row.document)?.document;
  if (!document) return null;
  return {
    sub: firestoreString(document, "sub"),
    email: firestoreString(document, "email"),
    name: firestoreString(document, "name"),
  };
}

async function listProjectFiles(env: Env, project: ProjectRow, cursorValue: string | null) {
  const cursor = cursorValue ? decodeJson<{ source: number; cursor: string | null }>(cursorValue) : null;
  if (cursorValue && (!cursor || !Number.isInteger(cursor.source) || cursor.source < 0 || cursor.source > 1 || (cursor.cursor !== null && typeof cursor.cursor !== "string"))) {
    throw new AuthFailure("The file cursor is invalid.", 400);
  }
  const sources = [
    { prefix: `projects/${project.id}/`, legacy: false },
    { prefix: `${project.ownerSub}/`, legacy: true },
  ];
  let sourceIndex = cursor?.source ?? 0;
  let sourceCursor = cursor?.cursor ?? null;
  const items: Array<{ id: string; name: string; contentType: string; size: number; uploadedAt: string; projectId: string }> = [];

  while (sourceIndex < sources.length && items.length < LIST_LIMIT) {
    const source = sources[sourceIndex];
    const listed = await env.FILES_BUCKET.list({ prefix: source.prefix, cursor: sourceCursor ?? undefined, limit: LIST_LIMIT - items.length, include: ["customMetadata"] });
    for (const object of listed.objects) {
      if (source.legacy && object.customMetadata?.projectId !== project.id) continue;
      items.push({
        id: object.key.slice(source.prefix.length),
        name: object.customMetadata?.originalName ?? "download",
        contentType: object.customMetadata?.contentType ?? "application/octet-stream",
        size: object.size,
        uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded.toISOString(),
        projectId: project.id,
      });
      if (items.length === LIST_LIMIT) break;
    }
    if (listed.truncated) {
      sourceCursor = listed.cursor ?? null;
      if (items.length === LIST_LIMIT) break;
    } else {
      sourceIndex += 1;
      sourceCursor = null;
    }
  }

  const nextCursor = sourceIndex < sources.length ? encodeJson({ source: sourceIndex, cursor: sourceCursor }) : null;
  return { items, cursor: nextCursor };
}

async function setProjectDeletedAt(env: Env, id: string, deletedAt: string | null): Promise<void> {
  const updateMask = new URLSearchParams();
  updateMask.append("updateMask.fieldPaths", "deletedAt");
  updateMask.append("updateMask.fieldPaths", "updatedAt");
  const fields: Record<string, { timestampValue: string }> = {
    updatedAt: { timestampValue: new Date().toISOString() },
  };
  if (deletedAt) fields.deletedAt = { timestampValue: deletedAt };
  await firestoreRequest<FirestoreDocument>(env, `/projects/${encodeURIComponent(id)}?${updateMask.toString()}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name, X-Project-Id",
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

async function getSsoIdentity(request: Request, env: Env): Promise<SsoIdentity> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new AuthFailure("A HyperDataLab SSO access token is required.", 401);

  let response: Response;
  try {
    const userinfoRequest = new Request(new URL("/oauth/userinfo", env.SSO_BASE_URL), {
      headers: { Authorization: `Bearer ${token}` },
    });
    response = env.SSO_GATEWAY
      ? await env.SSO_GATEWAY.fetch(userinfoRequest)
      : await fetch(userinfoRequest);
  } catch {
    throw new AuthFailure("HyperDataLab SSO is unavailable.", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthFailure("The SSO access token is invalid or expired.", 401);
  }
  if (!response.ok) {
    console.error("[Research Hub] SSO userinfo returned a non-success status.", { status: response.status });
    throw new AuthFailure("Could not verify the SSO access token.", 502);
  }

  const profile = await response.json() as SsoUserInfo;
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  const allowedEmail = /^[^@\s]+@hyperdatalab\.org$/i.test(email) &&
    profile.email_verified === true;
  if (!allowedEmail) throw new AuthFailure("Only verified @hyperdatalab.org accounts are allowed.", 403);
  if (typeof profile.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.sub)) {
    throw new AuthFailure("The SSO profile has no stable subject identifier.", 401);
  }
  return {
    sub: profile.sub,
    email,
    name: typeof profile.name === "string" ? profile.name.trim().slice(0, 120) : "",
    role: typeof profile.role === "string" ? profile.role : null,
  };
}

function validateToolUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return "";
  if (candidate.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return url.toString();
  }
  return null;
}

function readToolSettingsInput(value: unknown): ToolSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "paperLabUrl" && key !== "writingLabUrl")) return null;
  const paperLabUrl = validateToolUrl(body.paperLabUrl);
  const writingLabUrl = validateToolUrl(body.writingLabUrl);
  if (paperLabUrl === null || writingLabUrl === null) return null;
  return { paperLabUrl, writingLabUrl };
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

  let identity: SsoIdentity;
  try {
    identity = await getSsoIdentity(request, env);
  } catch (error) {
    if (error instanceof AuthFailure) return json({ error: error.message }, error.status, headers);
    throw error;
  }
  const uid = identity.sub;

  if (url.pathname === "/api/session" && request.method === "POST") {
    await registerResearchHubUser(env, identity);
    return json({ user: { email: identity.email, name: identity.name } }, 200, headers);
  }

  if (url.pathname === "/api/tool-settings" && request.method === "GET") {
    return json({ settings: await getToolSettings(env) }, 200, headers);
  }

  if (url.pathname === "/api/tool-settings" && request.method === "PUT") {
    if (identity.role?.trim().toLowerCase() !== "admin") {
      return json({ error: "Admin role is required to update tool settings." }, 403, headers);
    }
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return json({ error: "Tool settings must be valid JSON." }, 400, headers);
    }
    const settings = readToolSettingsInput(value);
    if (!settings) {
      return json({ error: "Enter valid HTTPS URLs, or HTTP URLs on localhost only." }, 400, headers);
    }
    return json({ settings: await saveToolSettings(env, settings, identity.sub) }, 200, headers);
  }

  if (url.pathname === "/api/projects" && request.method === "GET") {
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const items = (await listAccessibleProjects(env, identity)).filter((project) => includeDeleted || !project.deletedAt);
    return json({ items: items.map(projectForClient) }, 200, headers);
  }

  if (url.pathname === "/api/projects" && request.method === "POST") {
    const input = await readProjectInput(request);
    if (!input) {
      return json({ error: "Project name and description are invalid." }, 400, headers);
    }
    const now = new Date().toISOString();
    const project: ProjectRow = {
      id: crypto.randomUUID(),
      updateTime: null,
      ownerSub: identity.sub,
      ownerEmail: identity.email,
      accessRole: "owner",
      members: [],
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await firestoreRequest<FirestoreDocument>(env, `/projects?documentId=${encodeURIComponent(project.id)}`, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          ownerSub: { stringValue: uid },
          ownerEmail: { stringValue: identity.email },
          members: { arrayValue: { values: [] } },
          memberSubs: { arrayValue: { values: [] } },
          name: { stringValue: project.name },
          description: { stringValue: project.description },
          createdAt: { timestampValue: project.createdAt },
          updatedAt: { timestampValue: project.updatedAt },
        },
      }),
    });
    return json({ project: projectForClient(project) }, 201, headers);
  }

  const membersMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/members(?:\/([A-Za-z0-9_-]{1,128}))?$/i);
  if (membersMatch) {
    const projectId = membersMatch[1].toLowerCase();
    const project = await getOwnedProject(env, projectId, identity);
    if (!project) return json({ error: "Project not found or only its owner can manage members." }, 404, headers);
    if (request.method === "GET" && !membersMatch[2]) {
      return json({ members: project.members.map(({ sub, email, name, addedAt }) => ({ id: sub, email, name, addedAt })) }, 200, headers);
    }
    if (request.method === "POST" && !membersMatch[2]) {
      if (project.deletedAt) return json({ error: "Restore the project before changing its members." }, 409, headers);
      let value: unknown;
      try { value = await request.json(); } catch { return json({ error: "Member input must be valid JSON." }, 400, headers); }
      const emailValue = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).email : null;
      const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
      if (!/^[^@\s]+@hyperdatalab\.org$/.test(email)) return json({ error: "Enter a valid @hyperdatalab.org email address." }, 400, headers);
      const user = await findRegisteredUserByEmail(env, email);
      if (!user) return json({ error: "This user must sign in to Research Hub before they can be added." }, 404, headers);
      if (user.sub === project.ownerSub) return json({ error: "The project owner is already a member." }, 409, headers);
      if (project.members.some((member) => member.sub === user.sub)) return json({ error: "This user is already a project member." }, 409, headers);
      if (project.members.length >= 50) return json({ error: "A project can have up to 50 members." }, 409, headers);
      const members = [...project.members, { ...user, addedAt: new Date().toISOString() }];
      await saveProjectMembers(env, projectId, members, project.ownerEmail || identity.email, project.updateTime);
      return json({ members: members.map(({ sub, email: memberEmail, name, addedAt }) => ({ id: sub, email: memberEmail, name, addedAt })) }, 200, headers);
    }
    if (request.method === "DELETE" && membersMatch[2]) {
      const memberSub = membersMatch[2];
      const members = project.members.filter((member) => member.sub !== memberSub);
      if (members.length === project.members.length) return json({ error: "Project member not found." }, 404, headers);
      await saveProjectMembers(env, projectId, members, project.ownerEmail || identity.email, project.updateTime);
      return json({ members: members.map(({ sub, email, name, addedAt }) => ({ id: sub, email, name, addedAt })) }, 200, headers);
    }
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/(restore))?$/i);
  if (projectMatch) {
    const projectId = projectMatch[1].toLowerCase();
    const project = await getOwnedProject(env, projectId, identity);
    if (!project) return json({ error: "Project not found." }, 404, headers);

    if (request.method === "DELETE" && !projectMatch[2]) {
      if (!project.deletedAt) await setProjectDeletedAt(env, projectId, new Date().toISOString());
      const updated = await getOwnedProject(env, projectId, identity);
      return json({ project: updated ? projectForClient(updated) : null }, 200, headers);
    }
    if (request.method === "POST" && projectMatch[2] === "restore") {
      if (project.deletedAt) await setProjectDeletedAt(env, projectId, null);
      const updated = await getOwnedProject(env, projectId, identity);
      return json({ project: updated ? projectForClient(updated) : null }, 200, headers);
    }
  }

  if (url.pathname === "/api/files" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    const cursor = url.searchParams.get("cursor") ?? undefined;
    if (projectId) {
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "projectId must be a project UUID." }, 400, headers);
      const project = await getAccessibleProject(env, projectId.toLowerCase(), identity);
      if (!project) return json({ error: "Project not found or you do not have access." }, 404, headers);
      return json(await listProjectFiles(env, project, cursor ?? null), 200, headers);
    }
    const listed = await env.FILES_BUCKET.list({ prefix: `${uid}/`, cursor, limit: LIST_LIMIT, include: ["customMetadata"] });
    const items = listed.objects.map((object) => ({
      id: object.key.slice(uid.length + 1),
      name: object.customMetadata?.originalName ?? "download",
      contentType: object.customMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
      uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded.toISOString(),
      projectId: object.customMetadata?.projectId ?? null,
    }));
    return json({ items, cursor: listed.truncated ? listed.cursor : null }, 200, headers);
  }

  if (url.pathname === "/api/files" && request.method === "POST") {
    const projectId = request.headers.get("X-Project-Id")?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "X-Project-Id header is required and must be a project UUID." }, 400, headers);
    const project = await getAccessibleProject(env, projectId, identity);
    if (!project) return json({ error: "Project not found." }, 404, headers);
    if (project.deletedAt) return json({ error: "Cannot upload files to an archived project." }, 409, headers);

    const headerName = request.headers.get("X-File-Name");
    if (!headerName) return json({ error: "X-File-Name header is required." }, 400, headers);
    let suppliedName = headerName;
    try { suppliedName = decodeURIComponent(suppliedName); } catch { /* Keep the supplied value; safeFileName removes path characters. */ }
    const name = safeFileName(suppliedName);
    const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (!request.body) return json({ error: "File content is required." }, 400, headers);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return json({ error: "Content-Length header is required." }, 411, headers);
    if (contentLength > MAX_FILE_SIZE) return json({ error: "Maximum file size is 25 MB." }, 413, headers);

    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    let size = 0;
    const guardedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_FILE_SIZE) throw new Error("FILE_TOO_LARGE");
        controller.enqueue(chunk);
      },
    }));
    const fixedLength = new FixedLengthStream(contentLength);
    const writeStream = guardedBody.pipeTo(fixedLength.writable);

    try {
      const [stored] = await Promise.all([
        env.FILES_BUCKET.put(`projects/${projectId}/${id}`, fixedLength.readable, {
          httpMetadata: { contentType: "application/octet-stream" },
          customMetadata: { originalName: name, contentType: contentType.slice(0, 120), projectId, uploadedAt, uploadedBy: uid },
        }),
        writeStream,
      ] as const);
      return json({
        item: { id, name, contentType, size: stored.size, uploadedAt, projectId },
      }, 201, headers);
    } catch (error) {
      if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
        return json({ error: "Maximum file size is 25 MB." }, 413, headers);
      }
      throw error;
    }
  }

  const fileProjectMatch = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})\/project$/i);
  if (fileProjectMatch && request.method === "PUT") {
    let value: unknown;
    try { value = await request.json(); } catch { return json({ error: "Project assignment must be valid JSON." }, 400, headers); }
    const projectId = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).projectId
      : null;
    if (typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId)) {
      return json({ error: "A valid projectId is required." }, 400, headers);
    }
    const normalizedProjectId = projectId.toLowerCase();
    const project = await getAccessibleProject(env, normalizedProjectId, identity);
    if (!project) return json({ error: "Project not found." }, 404, headers);
    if (project.deletedAt) return json({ error: "Files can only be assigned to an active project." }, 409, headers);

    const id = fileProjectMatch[1].toLowerCase();
    const key = `${uid}/${id}`;
    const object = await env.FILES_BUCKET.get(key);
    if (!object) return json({ error: "File not found." }, 404, headers);
    const uploadedAt = object.customMetadata?.uploadedAt ?? object.uploaded.toISOString();
    const name = safeFileName(object.customMetadata?.originalName ?? "download");
    const contentType = object.customMetadata?.contentType ?? object.httpMetadata?.contentType ?? "application/octet-stream";
    await env.FILES_BUCKET.put(`projects/${normalizedProjectId}/${id}`, object.body, {
      httpMetadata: object.httpMetadata,
      customMetadata: { ...object.customMetadata, originalName: name, contentType, projectId: normalizedProjectId, uploadedAt, uploadedBy: uid },
    });
    await env.FILES_BUCKET.delete(key);
    return json({ item: { id, name, contentType, size: object.size, uploadedAt, projectId: normalizedProjectId } }, 200, headers);
  }

  const match = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (match) {
    const id = match[1].toLowerCase();
    const requestedProjectId = url.searchParams.get("projectId");
    let key = `${uid}/${id}`;
    let object: R2ObjectBody | null = null;
    if (requestedProjectId) {
      if (!/^[0-9a-f-]{36}$/i.test(requestedProjectId)) return json({ error: "projectId must be a project UUID." }, 400, headers);
      const project = await getAccessibleProject(env, requestedProjectId.toLowerCase(), identity);
      if (!project) return json({ error: "Project not found or you do not have access." }, 404, headers);
      key = `projects/${project.id}/${id}`;
      object = await env.FILES_BUCKET.get(key);
      if (!object) {
        key = `${project.ownerSub}/${id}`;
        object = await env.FILES_BUCKET.get(key);
        if (object?.customMetadata?.projectId !== project.id) object = null;
      }
    } else {
      object = await env.FILES_BUCKET.get(key);
    }
    if (request.method === "GET") {
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
      if (!object) return json({ error: "File not found." }, 404, headers);
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
      if (error instanceof AuthFailure) return json({ error: error.message }, error.status, headers);
      if (error instanceof FirestoreFailure) return json({ error: error.message }, error.status, headers);
      console.error("Request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Request failed." }, 500, headers);
    }
  },
};

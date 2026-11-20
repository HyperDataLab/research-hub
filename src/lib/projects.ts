export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  ownerEmail: string;
  accessRole: "owner" | "member";
  memberCount: number;
  members: ProjectMember[];
}

export interface ProjectMember {
  id: string;
  email: string;
  name: string;
  addedAt: string;
}

const apiUrl = (process.env.NEXT_PUBLIC_FILE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

function withLegacyOwnerRole(project: ResearchProject): ResearchProject {
  // The legacy Worker only returned projects filtered by ownerSub; member-aware Workers always return an explicit role.
  return {
    ...project,
    ownerEmail: project.ownerEmail ?? "",
    accessRole: project.accessRole ?? "owner",
    memberCount: project.memberCount ?? 0,
    members: project.members ?? [],
  };
}

async function request<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Worker trả về lỗi ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function listProjects(accessToken: string, includeDeleted = false): Promise<ResearchProject[]> {
  const path = includeDeleted ? "/api/projects?includeDeleted=true" : "/api/projects";
  const result = await request<{ items: ResearchProject[] }>(accessToken, path);
  return result.items.map(withLegacyOwnerRole);
}

export async function createProject(
  accessToken: string,
  input: { name: string; description: string },
): Promise<ResearchProject> {
  const result = await request<{ project: ResearchProject }>(accessToken, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return withLegacyOwnerRole(result.project);
}

export async function deleteProject(accessToken: string, id: string): Promise<ResearchProject> {
  const result = await request<{ project: ResearchProject }>(accessToken, `/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  return withLegacyOwnerRole(result.project);
}

export async function restoreProject(accessToken: string, id: string): Promise<ResearchProject> {
  const result = await request<{ project: ResearchProject }>(accessToken, `/api/projects/${encodeURIComponent(id)}/restore`, { method: "POST" });
  return withLegacyOwnerRole(result.project);
}

export async function registerResearchHubUser(accessToken: string): Promise<void> {
  await request<{ user: { email: string; name: string } }>(accessToken, "/api/session", { method: "POST" });
}

export async function addProjectMember(accessToken: string, id: string, email: string): Promise<ProjectMember[]> {
  const result = await request<{ members: ProjectMember[] }>(accessToken, `/api/projects/${encodeURIComponent(id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return result.members;
}

export async function removeProjectMember(accessToken: string, id: string, memberId: string): Promise<ProjectMember[]> {
  const result = await request<{ members: ProjectMember[] }>(accessToken, `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
  return result.members;
}

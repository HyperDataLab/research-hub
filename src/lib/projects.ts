export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

const apiUrl = (process.env.NEXT_PUBLIC_FILE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

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

export async function listProjects(accessToken: string): Promise<ResearchProject[]> {
  const result = await request<{ items: ResearchProject[] }>(accessToken, "/api/projects");
  return result.items;
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
  return result.project;
}

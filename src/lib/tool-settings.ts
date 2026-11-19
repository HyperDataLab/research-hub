export interface ToolSettings {
  paperLabUrl: string;
  writingLabUrl: string;
}

const apiUrl = (process.env.NEXT_PUBLIC_FILE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function request<T>(accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}/api/tool-settings`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Worker returned error ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function getToolSettings(accessToken: string): Promise<ToolSettings> {
  const result = await request<{ settings: ToolSettings }>(accessToken);
  return result.settings;
}

export async function saveToolSettings(accessToken: string, settings: ToolSettings): Promise<ToolSettings> {
  const result = await request<{ settings: ToolSettings }>(accessToken, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return result.settings;
}

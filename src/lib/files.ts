export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  projectId: string | null;
}

const apiUrl = (process.env.NEXT_PUBLIC_FILE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function request<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Worker trả về lỗi ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function listFiles(accessToken: string): Promise<StoredFile[]> {
  const items: StoredFile[] = [];
  let cursor: string | null = null;
  do {
    const cursorParam: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const result: { items: StoredFile[]; cursor: string | null } = await request<{ items: StoredFile[]; cursor: string | null }>(accessToken, `/api/files${cursorParam}`);
    items.push(...result.items);
    cursor = result.cursor;
  } while (cursor);
  return items;
}

export async function uploadFile(accessToken: string, projectId: string, file: File): Promise<void> {
  const response = await fetch(`${apiUrl}/api/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-Project-Id": projectId,
    },
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Worker trả về lỗi ${response.status}.`);
  }
}

export async function assignFileToProject(accessToken: string, id: string, projectId: string): Promise<StoredFile> {
  const result = await request<{ item: StoredFile }>(accessToken, `/api/files/${encodeURIComponent(id)}/project`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  return result.item;
}

export async function downloadFile(accessToken: string, file: StoredFile): Promise<void> {
  const response = await fetch(`${apiUrl}/api/files/${file.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Không tải được file.");
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(blobUrl);
}

export async function deleteFile(accessToken: string, id: string): Promise<void> {
  await request<{ ok: boolean }>(accessToken, `/api/files/${id}`, { method: "DELETE" });
}

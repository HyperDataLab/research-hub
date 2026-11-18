export interface StoredFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
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
  const result = await request<{ items: StoredFile[] }>(accessToken, "/api/files");
  return result.items;
}

export async function uploadFile(accessToken: string, file: File): Promise<void> {
  const response = await fetch(`${apiUrl}/api/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Worker trả về lỗi ${response.status}.`);
  }
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

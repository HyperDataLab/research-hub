import { listFiles, type StoredFile } from "@/lib/files";

export interface FileStoreSnapshot {
  items: StoredFile[];
  loading: boolean;
  error: string;
}

const EMPTY_SNAPSHOT: FileStoreSnapshot = { items: [], loading: false, error: "" };
let snapshot = EMPTY_SNAPSHOT;
let requestSequence = 0;
const subscribers = new Set<() => void>();

function publish(next: FileStoreSnapshot) {
  snapshot = next;
  for (const subscriber of subscribers) subscriber();
}

export function getFileStoreSnapshot(): FileStoreSnapshot {
  return snapshot;
}

export function getFileStoreServerSnapshot(): FileStoreSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeFileStore(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export async function refreshFileStore(accessToken: string): Promise<void> {
  const sequence = ++requestSequence;
  publish({ items: [], loading: true, error: "" });
  try {
    const items = await listFiles(accessToken);
    if (sequence === requestSequence) publish({ items, loading: false, error: "" });
  } catch (cause) {
    if (sequence === requestSequence) {
      publish({ items: [], loading: false, error: cause instanceof Error ? cause.message : "Không thể tải danh sách file." });
    }
  }
}

export function removeFileFromStore(id: string) {
  publish({ ...snapshot, items: snapshot.items.filter((file) => file.id !== id) });
}

export function clearFileStore() {
  requestSequence += 1;
  publish(EMPTY_SNAPSHOT);
}

// Google Drive REST v3. Images are fetched as blobs with a bearer token; no public links are ever created.

import { clearToken, getCachedToken } from './gis';
import { kvGet, kvSet } from '../db/dexie';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveAuthError extends Error {
  constructor() {
    super('drive-auth');
  }
}

export class DriveNotFoundError extends Error {
  constructor() {
    super('drive-not-found');
  }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getCachedToken();
  if (!token) throw new DriveAuthError();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearToken();
    throw new DriveAuthError();
  }
  if (res.status === 404) throw new DriveNotFoundError();
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {
      /* not json */
    }
    throw new Error(`Drive ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(q: string): Promise<string | null> {
  const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' });
  const res = await call(`${API}/files?${params}`);
  const json = (await res.json()) as { files: Array<{ id: string }> };
  return json.files[0]?.id ?? null;
}

async function exists(id: string): Promise<boolean> {
  try {
    const res = await call(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`);
    const json = (await res.json()) as { trashed?: boolean };
    return !json.trashed;
  } catch (e) {
    if (e instanceof DriveNotFoundError) return false;
    throw e;
  }
}

async function createFolder(name: string, parentId: string | undefined, appProperties: Record<string, string>) {
  const res = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties }),
  });
  return ((await res.json()) as { id: string }).id;
}

export async function getDriveEmail(): Promise<string | undefined> {
  const res = await call(`${API}/about?fields=user(emailAddress)`);
  return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress;
}

const ROOT_KEY = 'drive:root';
const folderKey = (documentId: string) => `drive:folder:${documentId}`;

/** The app's "LabelSnap" folder in the user's Drive, created on first use. */
export async function ensureRootFolder(): Promise<string> {
  const cached = await kvGet<string>(ROOT_KEY);
  if (cached && (await exists(cached))) return cached;
  const found = await findOne(
    `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='labelsnapRoot' and value='1' }`,
  );
  const id = found ?? (await createFolder('LabelSnap', undefined, { labelsnapRoot: '1' }));
  await kvSet(ROOT_KEY, id);
  return id;
}

/** One Drive folder per Document, found by its app property so it is shared across devices. */
export async function ensureDocumentFolder(documentId: string, title: string): Promise<string> {
  const cached = await kvGet<string>(folderKey(documentId));
  if (cached && (await exists(cached))) return cached;
  const root = await ensureRootFolder();
  const found = await findOne(
    `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='labelsnapDocument' and value='${esc(documentId)}' }`,
  );
  const safeTitle = title.replace(/[\\/]/g, '-').slice(0, 80) || 'Document';
  const id = found ?? (await createFolder(`${safeTitle} (${documentId.slice(0, 8)})`, root, { labelsnapDocument: documentId }));
  await kvSet(folderKey(documentId), id);
  return id;
}

export async function cachedDocumentFolder(documentId: string): Promise<string | undefined> {
  return kvGet<string>(folderKey(documentId));
}

export async function forgetDocumentFolder(documentId: string): Promise<void> {
  await kvSet(folderKey(documentId), undefined);
}

export async function findDocumentFolder(documentId: string): Promise<string | null> {
  const cached = await kvGet<string>(folderKey(documentId));
  if (cached) return cached;
  return findOne(
    `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='labelsnapDocument' and value='${esc(documentId)}' }`,
  );
}

/** Multipart upload; returns the new file id. */
export async function uploadFile(
  blob: Blob,
  name: string,
  parentId: string,
  appProperties: Record<string, string>,
): Promise<string> {
  const boundary = `labelsnap${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: [parentId], appProperties, mimeType: blob.type || 'image/jpeg' };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await call(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return ((await res.json()) as { id: string }).id;
}

/** Finds a file previously uploaded for an entry variant (recovers from a lost upload response). */
export async function findEntryFile(entryId: string, variant: string): Promise<string | null> {
  return findOne(
    `trashed=false and appProperties has { key='labelsnapEntry' and value='${esc(entryId)}' } and appProperties has { key='labelsnapVariant' and value='${esc(variant)}' }`,
  );
}

export async function downloadFile(id: string): Promise<Blob> {
  const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  return res.blob();
}

export async function deleteFile(id: string): Promise<void> {
  try {
    await call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof DriveNotFoundError)) throw e;
  }
}

export async function copyFile(
  id: string,
  parentId: string,
  name: string,
  appProperties: Record<string, string>,
): Promise<string> {
  const res = await call(`${API}/files/${encodeURIComponent(id)}/copy?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], appProperties }),
  });
  return ((await res.json()) as { id: string }).id;
}

export async function moveFile(id: string, addParent: string, removeParent?: string): Promise<void> {
  const params = new URLSearchParams({ addParents: addParent, fields: 'id' });
  if (removeParent) params.set('removeParents', removeParent);
  await call(`${API}/files/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

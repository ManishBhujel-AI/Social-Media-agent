import fs from "fs/promises";
import path from "path";
import { put, head, list } from "@vercel/blob";
import { createId } from "@paralleldrive/cuid2";

export interface StorageResult {
  url: string;
  key: string;
}

export interface StorageAdapter {
  saveUpload(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult>;
  saveGenerated(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult>;
  readAsDataUrl(url: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

const LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT ?? process.cwd();

class LocalStorage implements StorageAdapter {
  async saveUpload(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult> {
    const dir = path.join(LOCAL_ROOT, "uploads");
    await fs.mkdir(dir, { recursive: true });
    const ext = mime.split("/")[1] ?? "bin";
    const key = filename ?? `${createId()}.${ext}`;
    const filePath = path.join(dir, key);
    await fs.writeFile(filePath, buffer);
    return { url: `/api/files/uploads/${key}`, key };
  }

  async saveGenerated(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult> {
    const dir = path.join(LOCAL_ROOT, "generated");
    await fs.mkdir(dir, { recursive: true });
    const ext = mime.split("/")[1] ?? "png";
    const key = filename ?? `${createId()}.${ext}`;
    const filePath = path.join(dir, key);
    await fs.writeFile(filePath, buffer);
    return { url: `/api/files/generated/${key}`, key };
  }

  async readAsDataUrl(url: string): Promise<string> {
    const key = url.split("/").pop()!;
    const folder = url.includes("/uploads/") ? "uploads" : "generated";
    const filePath = path.join(LOCAL_ROOT, folder, key);
    const buf = await fs.readFile(filePath);
    const mime = key.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(path.join(LOCAL_ROOT, key));
      return true;
    } catch {
      return false;
    }
  }
}

class BlobStorage implements StorageAdapter {
  async saveUpload(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult> {
    const key = filename ?? `uploads/${createId()}`;
    const blob = await put(key, buffer, { access: "public", contentType: mime });
    return { url: blob.url, key };
  }

  async saveGenerated(buffer: Buffer, mime: string, filename?: string): Promise<StorageResult> {
    const key = filename ? `generated/${filename}` : `generated/${createId()}.png`;
    const blob = await put(key, buffer, {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
    });
    return { url: blob.url, key };
  }

  async readAsDataUrl(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const { blobs } = await list({ prefix: key });
      const match = blobs.find((b) => b.pathname === key);
      if (!match) return false;
      await head(match.url);
      return true;
    } catch {
      return false;
    }
  }
}

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = process.env.BLOB_READ_WRITE_TOKEN ? new BlobStorage() : new LocalStorage();
  }
  return adapter;
}

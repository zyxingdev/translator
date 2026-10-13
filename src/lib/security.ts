import { Unzip, UnzipInflate, strFromU8 } from "fflate";
export async function hash(bytes: Uint8Array | string) {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", data as BufferSource),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function safePath(path: string) {
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /[\x00-\x1f]/.test(path) ||
    /^[a-z]+:/i.test(path)
  )
    throw Error("文档包含不安全资源路径");
  const parts: string[] = [];
  for (const p of path.split("/")) {
    if (p === "..") {
      if (!parts.length) throw Error("资源路径越界");
      parts.pop();
    } else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}
export function resolvePath(base: string, relative: string) {
  if (/^[a-z]+:|^\/\//i.test(relative)) throw Error("不加载远程资源");
  return safePath(
    (base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "") +
      decodeURIComponent(relative.split("#")[0].split("?")[0]),
  );
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function boundedUnzip(
  bytes: Uint8Array,
  maxBytes = 50 * 1024 * 1024,
  maxItems = 2000,
  maxCompressed = 20 * 1024 * 1024,
) {
  if (bytes.length > maxCompressed) throw Error("压缩文件超过限制");
  const files: Record<string, Uint8Array> = {};
  let total = 0,
    count = 0,
    fatal: Error | null = null;
  const unzip = new Unzip((file) => {
    try {
      const path = safePath(file.name);
      if (++count > maxItems) throw Error("ZIP 文件项超过限制");
      if (path in files) throw Error("ZIP 包含重复资源");
      files[path] = new Uint8Array();
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (err, data, final) => {
        if (fatal) return;
        if (err) {
          fatal = Error("ZIP 解压失败");
          return;
        }
        size += data.length;
        total += data.length;
        if (total > maxBytes || total > Math.max(bytes.length, 1) * 100) {
          fatal = Error("ZIP 解压体积或压缩比超过限制");
          file.terminate();
          return;
        }
        chunks.push(data);
        if (final) {
          const out = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          files[path] = out;
        }
      };
      file.start();
    } catch (e) {
      fatal = e as Error;
      file.terminate();
    }
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 65536) {
    unzip.push(bytes.subarray(i, i + 65536), i + 65536 >= bytes.length);
    if (fatal) throw fatal;
  }
  return files;
}
export const decode = strFromU8;

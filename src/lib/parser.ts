import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  boundedUnzip,
  decode,
  hash,
  resolvePath,
  escapeHtml,
} from "./security";
import {
  type DocumentIR,
  type Block,
  type Section,
  type Resource,
  estimateTokens,
} from "./types";
const elements = (node: any, name: string): any[] =>
  Array.from(node.getElementsByTagName("*")).filter(
    (e: any) => (e.localName || e.nodeName.split(":").at(-1)) === name,
  );
function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error("XML 含不支持的外部实体或文档类型");
  let bad = false;
  const doc = new DOMParser({
    onError: (level) => {
      if (level !== "warning") bad = true;
    },
  }).parseFromString(text, "application/xml");
  if (bad || !doc.documentElement) throw Error("XML 结构损坏");
  return doc;
}
const extMime = (path: string) =>
  /\.png$/i.test(path)
    ? "image/png"
    : /\.jpe?g$/i.test(path)
      ? "image/jpeg"
      : /\.gif$/i.test(path)
        ? "image/gif"
        : /\.webp$/i.test(path)
          ? "image/webp"
          : "application/octet-stream";
export function splitText(text: string, max = 3500) {
  const result: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let at = rest.slice(0, max).search(/[.!?。！？]\s*[^.!?。！？]*$/);
    if (at < max / 2) at = max;
    else at++;
    result.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) result.push(rest);
  return result;
}
export async function parseDocument(
  bytes: Uint8Array,
  name: string,
  mobile: boolean,
  progress: (n: number, label: string) => void,
  assetBase?: string,
): Promise<DocumentIR> {
  const limit = mobile ? 5 : 10;
  if (bytes.length > limit * 1024 * 1024)
    throw Error(`文件超过 ${limit} MiB 上限`);
  const fileHash = await hash(bytes);
  let doc: DocumentIR;
  if (/\.pdf$/i.test(name) && decode(bytes.slice(0, 5)) === "%PDF-")
    doc = await parsePDF(bytes, name, mobile, progress, assetBase);
  else if (/\.epub$/i.test(name) && bytes[0] === 80 && bytes[1] === 75)
    doc = await parseEPUB(bytes, name, progress);
  else throw Error("请选择内容签名有效的 PDF 或 EPUB 文件");
  doc.fileHash = fileHash;
  doc.estimatedTokens = estimateTokens(
    doc.blocks.map((b) => b.text).join("\n"),
  );
  if (doc.estimatedTokens > 50000)
    throw Error("源文估算超过 50,000 tokens 上限");
  if (!doc.blocks.some((b) => b.text.trim())) throw Error("没有可识别正文");
  return doc;
}
async function parsePDF(
  bytes: Uint8Array,
  name: string,
  mobile: boolean,
  progress: (n: number, label: string) => void,
  assetBase?: string,
): Promise<DocumentIR> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    ...(assetBase
      ? {
          cMapUrl: assetBase + "pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: assetBase + "pdfjs/standard_fonts/",
          wasmUrl: assetBase + "pdfjs/wasm/",
        }
      : {}),
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    throw Error(
      "PDF 损坏、受密码保护或解析器初始化失败，请合法重新导出或刷新重试",
      { cause: e },
    );
  }
  try {
    if (pdf.numPages > (mobile ? 30 : 100))
      throw Error(`PDF 超过 ${mobile ? 30 : 100} 页上限`);
    const blocks: Block[] = [],
      sections: Section[] = [],
      warnings: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      progress(
        (pageNum / pdf.numPages) * 100,
        `解析第 ${pageNum} / ${pdf.numPages} 页`,
      );
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const items = tc.items.filter(
        (x: any) => "str" in x && x.str.trim(),
      ) as any[];
      const sid = `page-${pageNum}`;
      sections.push({ id: sid, title: `第 ${pageNum} 页`, order: pageNum - 1 });
      if (!items.length) {
        warnings.push(
          `第 ${pageNum} 页无可提取文本，未翻译该页；扫描 OCR 不受支持。`,
        );
        page.cleanup();
        continue;
      }
      const width = page.getViewport({ scale: 1 }).width;
      const sorted = [...items].sort((a, b) =>
        Math.abs(a.transform[5] - b.transform[5]) > 3
          ? b.transform[5] - a.transform[5]
          : a.transform[4] - b.transform[4],
      );
      const lines: {
        y: number;
        x: number;
        height: number;
        text: string;
        end: number;
      }[] = [];
      let separated = 0;
      for (const i of sorted) {
        const y = i.transform[5],
          x = i.transform[4],
          height = Math.abs(i.transform[3]) || 12;
        const last = lines.at(-1);
        if (last && Math.abs(last.y - y) < height * 0.35) {
          if (x - last.end > width * 0.18) separated++;
          last.text += (x - last.end > 2 ? " " : "") + i.str;
          last.end = x + i.width;
        } else lines.push({ y, x, height, text: i.str, end: x + i.width });
      }
      if (separated >= 3)
        throw Error(
          `第 ${pageNum} 页疑似多栏或复杂表格，阅读顺序不可靠。请重新导出单栏文档。`,
        );
      let current = "",
        heading = false;
      const flush = () => {
        if (!current.trim()) return;
        for (const text of splitText(current)) {
          blocks.push({
            id: `p${pageNum}-b${blocks.length}`,
            sectionId: sid,
            order: blocks.length,
            type: heading
              ? "heading"
              : /^\s*(?:[•●\-]|\d+[.)])\s/.test(text)
                ? "list"
                : "paragraph",
            text,
            locator: `源文第 ${pageNum} 页`,
            flags: [],
            level: 2,
          });
        }
        current = "";
      };
      const heights = lines.map((l) => l.height).sort((a, b) => a - b);
      const normal = heights[Math.floor(heights.length / 2)] || 12;
      for (let j = 0; j < lines.length; j++) {
        const l = lines[j];
        const isHeading = l.height > normal * 1.25 && l.text.length < 150;
        const previous = lines[j - 1];
        if (
          isHeading ||
          heading ||
          (previous && previous.y - l.y > normal * 1.8)
        )
          flush();
        heading = isHeading;
        current +=
          (current
            ? /[\u3400-\u9fff]$/.test(current) &&
              /^[\u3400-\u9fff]/.test(l.text)
              ? ""
              : " "
            : "") + l.text;
        if (isHeading) flush();
      }
      flush();
      const ops = await page.getOperatorList();
      if (
        ops.fnArray.some((o: number) =>
          [
            pdfjs.OPS.paintImageXObject,
            pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.constructPath,
          ].includes(o),
        )
      ) {
        warnings.push(
          `第 ${pageNum} 页含图片、图形或公式绘图：原页作为附件保留，图内文字不翻译。`,
        );
        const viewport = page.getViewport({ scale: 1 });
        if (typeof OffscreenCanvas !== "undefined") {
          const canvas = new OffscreenCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
          await page.render({
            canvas: canvas as any,
            canvasContext: canvas.getContext("2d") as any,
            viewport,
          }).promise;
          const blob = await canvas.convertToBlob({ type: "image/png" });
          const path = `assets/page-${pageNum}.png`;
          resourcesTemp.push({
            path,
            mime: "image/png",
            data: new Uint8Array(await blob.arrayBuffer()),
          });
          blocks.push({
            id: `p${pageNum}-image`,
            sectionId: sid,
            order: blocks.length,
            type: "image",
            text: `源文第 ${pageNum} 页原页（未翻译图形）`,
            resource: path,
            locator: `源文第 ${pageNum} 页`,
            flags: ["原页附件，非译稿"],
          });
        } else
          warnings.push(
            `第 ${pageNum} 页当前浏览器无法生成原页图，请参考原文件。`,
          );
      }
      page.cleanup();
    }
    const resources = resourcesTemp.splice(0);
    return {
      title: name.replace(/\.pdf$/i, ""),
      author: "",
      format: "pdf",
      fileHash: "",
      sections,
      blocks,
      resources,
      warnings,
      pages: pdf.numPages,
      estimatedTokens: 0,
    };
  } finally {
    resourcesTemp.length = 0;
    await task.destroy();
  }
}
const resourcesTemp: Resource[] = [];
async function parseEPUB(
  bytes: Uint8Array,
  name: string,
  progress: (n: number, label: string) => void,
): Promise<DocumentIR> {
  const files = await boundedUnzip(bytes);
  if (
    !files.mimetype ||
    decode(files.mimetype).trim() !== "application/epub+zip"
  )
    throw Error("EPUB mimetype 无效");
  if (!files["META-INF/container.xml"]) throw Error("EPUB 缺少 container.xml");
  if (files["META-INF/encryption.xml"])
    throw Error("EPUB 包含加密资源，不支持 DRM 或加密字体");
  const container = xml(decode(files["META-INF/container.xml"]));
  const opfPath = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath || !files[opfPath]) throw Error("EPUB package 路径无效");
  const opf = xml(decode(files[opfPath]));
  if (
    elements(opf, "meta").some(
      (e) =>
        e.getAttribute("property") === "rendition:layout" &&
        e.textContent === "pre-paginated",
    )
  )
    throw Error("不支持固定版式 EPUB");
  const manifest = new Map<
    string,
    { path: string; mime: string; properties: string }
  >();
  for (const e of elements(opf, "item"))
    manifest.set(e.getAttribute("id"), {
      path: resolvePath(opfPath, e.getAttribute("href")),
      mime: e.getAttribute("media-type"),
      properties: e.getAttribute("properties") || "",
    });
  const spine = elements(opf, "itemref").filter(
    (e) => e.getAttribute("linear") !== "no",
  );
  if (!spine.length) throw Error("EPUB 缺少有效 spine 阅读顺序");
  const sections: Section[] = [],
    blocks: Block[] = [],
    warnings: string[] = [],
    resources: Resource[] = [];
  for (const item of manifest.values()) {
    if (item.mime.startsWith("image/")) {
      if (!files[item.path]) warnings.push(`缺失图片：${item.path}`);
      else if (item.mime === "image/svg+xml")
        warnings.push(`SVG 图片未加载：${item.path}`);
      else
        resources.push({
          path: item.path,
          mime: extMime(item.path),
          data: files[item.path],
        });
    }
  }
  const allowed = new Set([
    "html",
    "head",
    "title",
    "body",
    "div",
    "section",
    "article",
    "p",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "sub",
    "sup",
    "br",
    "a",
    "img",
    "blockquote",
    "pre",
    "code",
    "aside",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
  ]);
  for (let chapter = 0; chapter < spine.length; chapter++) {
    const item = manifest.get(spine[chapter].getAttribute("idref"));
    if (!item || !files[item.path]) throw Error("EPUB spine 引用不存在");
    if (item.mime !== "application/xhtml+xml") throw Error("章节格式不受支持");
    progress(
      ((chapter + 1) / spine.length) * 100,
      `解析第 ${chapter + 1} / ${spine.length} 章`,
    );
    const source = decode(files[item.path]).replace(/<!DOCTYPE[^>]*>/gi, "");
    const doc = xml(source);
    const body = elements(doc, "body")[0];
    if (!body) throw Error("EPUB 章节缺少正文");
    const sid = `chapter-${chapter + 1}`;
    const clean = (node: any) => {
      for (const child of Array.from(node.childNodes) as any[]) {
        if (child.nodeType === 1) {
          const tag = (child.localName || child.nodeName).toLowerCase();
          if (!allowed.has(tag)) {
            warnings.push(`章节 ${chapter + 1} 移除不支持内容：${tag}`);
            node.removeChild(child);
            continue;
          }
          for (const attr of Array.from(child.attributes) as any[]) {
            if (
              ![
                "id",
                "href",
                "src",
                "alt",
                "title",
                "colspan",
                "rowspan",
                "lang",
                "xml:lang",
              ].includes(attr.name)
            )
              child.removeAttribute(attr.name);
          }
          if (tag === "a") {
            const href = child.getAttribute("href");
            if (href && /^[a-z]+:|^\/\//i.test(href))
              child.removeAttribute("href");
            else if (href) {
              try {
                resolvePath(item.path, href);
              } catch {
                child.removeAttribute("href");
              }
            }
          }
          if (tag === "img") {
            try {
              const path = resolvePath(
                item.path,
                child.getAttribute("src") || "",
              );
              if (!resources.some((r) => r.path === path)) throw Error();
            } catch {
              warnings.push(`章节 ${chapter + 1} 图片未加载`);
              node.removeChild(child);
              continue;
            }
          }
          clean(child);
        } else if (![3, 4].includes(child.nodeType)) node.removeChild(child);
      }
    };
    clean(body);
    const titleNode = elements(body, "h1")[0] || elements(body, "h2")[0];
    sections.push({
      id: sid,
      title: titleNode?.textContent?.trim() || `第 ${chapter + 1} 章`,
      order: chapter,
      path: item.path,
    });
    let seq = 0;
    const walk = (node: any) => {
      if (node.nodeType !== 1) return;
      const tag = (node.localName || node.nodeName).toLowerCase();
      if (tag === "img") {
        const id = `${sid}-b${seq++}`;
        node.setAttribute("data-yiye-id", id);
        blocks.push({
          id,
          sectionId: sid,
          order: blocks.length,
          type: "image",
          text: node.getAttribute("alt") || "原文图片",
          resource: resolvePath(item.path, node.getAttribute("src")),
          anchor: node.getAttribute("id") || undefined,
          locator: `第 ${chapter + 1} 章`,
          flags: [],
        });
        return;
      }
      const childEls = Array.from(node.childNodes).filter(
        (c: any) => c.nodeType === 1,
      ) as any[];
      const containsBlock = childEls.some((c) =>
        [
          "p",
          "div",
          "section",
          "li",
          "h1",
          "h2",
          "h3",
          "blockquote",
          "table",
          "tr",
          "td",
          "pre",
        ].includes(c.localName || c.nodeName),
      );
      if (!containsBlock && node.textContent?.trim() && tag !== "body") {
        const id = `${sid}-b${seq++}`;
        node.setAttribute("data-yiye-id", id);
        const text = node.textContent.replace(/\s+/g, " ").trim();
        const parts = splitText(text);
        for (let k = 0; k < parts.length; k++) {
          const bid = k ? `${id}-part${k}` : id;
          blocks.push({
            id: bid,
            sectionId: sid,
            order: blocks.length,
            type: /^h[1-6]$/.test(tag)
              ? "heading"
              : tag === "pre" || tag === "code"
                ? "code"
                : tag === "li"
                  ? "list"
                  : "paragraph",
            text: parts[k],
            spans: [
              {
                text: parts[k],
                bold: !!elements(node, "strong").length,
                italic: !!elements(node, "em").length,
              },
              ...elements(node, "code").map((n) => ({
                text: n.textContent || "",
                protected: true,
              })),
            ],
            anchor: k ? undefined : node.getAttribute("id") || undefined,
            locator: `第 ${chapter + 1} 章 · 段 ${seq}`,
            level: /^h[1-6]$/.test(tag) ? Number(tag[1]) : undefined,
            flags: parts.length > 1 ? ["长段分块"] : [],
          });
        }
        for (const img of elements(node, "img")) walk(img);
        return;
      }
      for (const child of Array.from(node.childNodes) as any[]) {
        if (child.nodeType === 3 && child.data.trim()) {
          const span = doc.createElement("span");
          span.appendChild(doc.createTextNode(child.data));
          node.replaceChild(span, child);
          walk(span);
        } else walk(child);
      }
    };
    walk(body);
    resources.push({
      path: item.path,
      mime: "application/xhtml+xml",
      data: new TextEncoder().encode(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(sections.at(-1)!.title)}</title></head>${new XMLSerializer().serializeToString(body)}</html>`,
      ),
    });
  }
  const coverItem =
    [...manifest.values()].find((m) =>
      m.properties.split(" ").includes("cover-image"),
    ) ||
    manifest.get(
      elements(opf, "meta")
        .find((m) => m.getAttribute("name") === "cover")
        ?.getAttribute("content"),
    );
  warnings.push(
    "EPUB 已清除脚本、交互、远程资源和原始 CSS；导出保留安全的基础结构与样式。",
  );
  return {
    title:
      elements(opf, "title")[0]?.textContent || name.replace(/\.epub$/i, ""),
    author: elements(opf, "creator")[0]?.textContent || "",
    format: "epub",
    fileHash: "",
    sections,
    blocks,
    resources,
    warnings,
    coverPath:
      coverItem && resources.some((r) => r.path === coverItem.path)
        ? coverItem.path
        : undefined,
    pages: 0,
    estimatedTokens: 0,
  };
}

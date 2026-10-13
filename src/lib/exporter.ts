import { zipSync, strToU8, strFromU8 } from "fflate";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  type Project,
  type Block,
  selectedRevision,
  translatable,
  defaultConfig,
} from "./types";
import {
  hash,
  boundedUnzip,
  escapeHtml,
  safePath,
  resolvePath,
} from "./security";
import { providers } from "./providers";
const txt = (p: Project, b: Block) =>
  selectedRevision(p, b.id)?.text ||
  (translatable(b) ? `【未翻译】${b.text}` : b.text);
export function report(p: Project) {
  return {
    title: p.doc.title,
    format: p.doc.format,
    sourceHash: p.doc.fileHash,
    config: p.config,
    configHash: p.configHash,
    sourceBlocks: p.doc.blocks.length,
    translated: p.completed.length,
    untranslated: p.doc.blocks
      .filter((b) => translatable(b) && !selectedRevision(p, b.id))
      .map((b) => b.locator),
    warnings: p.doc.warnings,
    attempts: p.attempts,
    generatedAt: new Date().toISOString(),
    demo: !!p.demo,
  };
}
const css =
  "body{font-family:serif;line-height:1.8;max-width:48em;margin:2em auto;padding:0 1em;color:#24332b}h1,h2,h3{line-height:1.4}img{max-width:100%}.source{color:#626d66;margin-bottom:.4em}.target{margin-bottom:1.2em}pre{white-space:pre-wrap}a{color:#246b56}.warning{padding:1em;background:#fff4da}";
export async function exportProject(
  p: Project,
  format: string,
  bilingual: boolean,
  progress: (n: number, label: string) => void,
  font?: Uint8Array,
): Promise<{ bytes: Uint8Array; mime: string; extension: string }> {
  if (format === "pdf") {
    if (p.doc.format !== "pdf") throw Error("EPUB→PDF 属于后续版本");
    if (!font) throw Error("中文字体尚未加载");
    return {
      bytes: await exportPDF(p, bilingual, font, progress),
      mime: "application/pdf",
      extension: "pdf",
    };
  }
  if (format === "epub") {
    if (p.doc.format !== "epub") throw Error("PDF→EPUB 属于后续版本");
    return {
      bytes: await exportEPUB(p, bilingual),
      mime: "application/epub+zip",
      extension: "epub",
    };
  }
  const files: Record<string, Uint8Array> = {};
  const parts: string[] = [];
  for (const s of p.doc.sections) {
    parts.push(
      format === "html" ? `<h2>${escapeHtml(s.title)}</h2>` : `## ${s.title}\n`,
    );
    for (const b of p.doc.blocks.filter((x) => x.sectionId === s.id)) {
      if (b.type === "image" && b.resource) {
        parts.push(
          format === "html"
            ? `<figure><img src="${escapeHtml(b.resource)}" alt="${escapeHtml(b.text)}"/><figcaption>${escapeHtml(b.text)}</figcaption></figure>`
            : `![${b.text.replace(/[\[\]]/g, "")}](${encodeURI(b.resource)})\n`,
        );
        continue;
      }
      const text = txt(p, b);
      if (format === "html") {
        const tag =
          b.type === "heading" ? "h3" : b.type === "code" ? "pre" : "p";
        parts.push(
          `<section id="${escapeHtml(b.id)}">${bilingual && translatable(b) ? `<p class="source" lang="${p.config.direction === "en-zh" ? "en" : "zh-CN"}">${escapeHtml(b.text)}</p>` : ""}<${tag} class="target" lang="${p.config.direction === "en-zh" ? "zh-CN" : "en"}">${escapeHtml(text)}</${tag}></section>`,
        );
      } else
        parts.push(
          (bilingual ? `${b.text}\n\n` : "") +
            (b.type === "heading" ? "### " : b.type === "code" ? "```\n" : "") +
            text +
            (b.type === "code" ? "\n```" : "") +
            "\n",
        );
    }
  }
  for (const r of p.doc.resources.filter((r) => r.mime.startsWith("image/")))
    files[safePath(r.path)] = r.data;
  const warnings = p.doc.warnings.join("\n");
  const content =
    format === "html"
      ? `<!doctype html><html lang="${p.config.direction === "en-zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/><title>${escapeHtml(p.doc.title)}</title><style>${css}</style></head><body><h1>${escapeHtml(p.doc.title)}</h1><p>译页 · ${bilingual ? "双语对照" : "译文"} · ${escapeHtml(p.config.model)}${p.demo ? " · 内置演示译稿" : ""}</p><aside class="warning">${escapeHtml(warnings)}<br/>未完成段落标记为【未翻译】；详见 report.json。</aside>${parts.join("\n")}</body></html>`
      : `# ${p.doc.title}\n\n> 译页 · ${p.config.model}${p.demo ? " · 内置演示译稿" : ""}\n> 未完成段落标记为【未翻译】，降级信息详见 report.json。\n\n${parts.join("\n")}\n\n## 处理说明\n${warnings}`;
  files[`translation.${format === "html" ? "html" : "md"}`] = strToU8(content);
  files["report.json"] = strToU8(JSON.stringify(report(p), null, 2));
  return {
    bytes: zipSync(files),
    mime: "application/zip",
    extension: `${format}.zip`,
  };
}
async function exportPDF(
  p: Project,
  bilingual: boolean,
  fontBytes: Uint8Array,
  progress: (n: number, label: string) => void,
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  let page = doc.addPage([595, 842]),
    y = 790;
  const margin = 48,
    width = 499;
  const addPage = () => {
    page = doc.addPage([595, 842]);
    y = 790;
  };
  const draw = (text: string, size = 11, color = rgb(0.14, 0.2, 0.17)) => {
    for (const c of text) {
      if (!supported.has(c.codePointAt(0)!) && !/\s/.test(c))
        throw Error(`中文字体缺少字形 ${c}，请使用 HTML 导出或调整内容`);
    }
    for (const para of text.replace(/\t/g, "    ").split("\n")) {
      let line = "";
      const emit = () => {
        if (y < size * 1.8 + margin) addPage();
        if (line) page.drawText(line, { x: margin, y, size, font, color });
        y -= size * 1.8;
        line = "";
      };
      for (const c of para) {
        if (font.widthOfTextAtSize(line + c, size) > width) emit();
        line += c;
      }
      emit();
    }
    y -= 8;
  };
  draw(p.doc.title, 22);
  draw(
    `译页 · ${bilingual ? "双语对照" : "重排译文"}${p.demo ? " · 演示稿" : ""}`,
    10,
  );
  draw(
    "本文件为重排版本。未完成内容标记为【未翻译】，原分页与交互功能不保留。",
    10,
  );
  for (const warning of p.doc.warnings) draw(warning, 9, rgb(0.5, 0.33, 0.1));
  for (let i = 0; i < p.doc.blocks.length; i++) {
    const b = p.doc.blocks[i];
    progress(((i + 1) / p.doc.blocks.length) * 100, "生成可搜索 PDF");
    if (b.type === "image" && b.resource) {
      const resource = p.doc.resources.find((r) => r.path === b.resource);
      if (resource) {
        const image =
          resource.mime === "image/png"
            ? await doc.embedPng(resource.data)
            : resource.mime === "image/jpeg"
              ? await doc.embedJpg(resource.data)
              : null;
        if (image) {
          const scale = Math.min(width / image.width, 600 / image.height),
            h = image.height * scale;
          if (y - h < margin) addPage();
          page.drawImage(image, {
            x: margin,
            y: y - h,
            width: image.width * scale,
            height: h,
          });
          y -= h + 16;
        }
      }
      continue;
    }
    draw(b.locator, 8, rgb(0.5, 0.55, 0.5));
    if (bilingual && translatable(b)) draw(b.text, 11, rgb(0.45, 0.49, 0.46));
    draw(txt(p, b), b.type === "heading" ? 16 : 11);
  }
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++)
    pages[i].drawText(`${i + 1} / ${pages.length}`, {
      x: 275,
      y: 24,
      font,
      size: 8,
    });
  doc.setTitle(p.doc.title);
  doc.setCreator("译页");
  return doc.save();
}
async function exportEPUB(p: Project, bilingual: boolean) {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
  };
  files["META-INF/container.xml"] = strToU8(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const parser = new DOMParser(),
    serializer = new XMLSerializer();
  const sections = p.doc.sections;
  const manifest: string[] = [],
    spine: string[] = [],
    nav: string[] = [];
  for (const resource of p.doc.resources.filter((r) =>
    r.mime.startsWith("image/"),
  ))
    files[resource.path] = resource.data;
  for (const s of sections) {
    const path = s.path || `chapter-${s.order}.xhtml`;
    const original = p.doc.resources.find(
      (r) => r.path === s.path && r.mime === "application/xhtml+xml",
    );
    const chapter = parser.parseFromString(
      original
        ? strFromU8(original.data)
        : `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body/></html>`,
      "application/xml",
    );
    const body = chapter.getElementsByTagName("body")[0];
    const nodes = Array.from(body.getElementsByTagName("*"));
    for (const node of nodes) {
      const id = node.getAttribute("data-yiye-id");
      if (!id) continue;
      node.removeAttribute("data-yiye-id");
      const b = p.doc.blocks.find((b) => b.id === id);
      if (!b || b.type === "image" || b.type === "code") continue;
      const group = p.doc.blocks.filter(
        (x) => x.id === id || x.id.startsWith(id + "-part"),
      );
      const text = group.map((x) => txt(p, x)).join(" ");
      if (bilingual) {
        const el = chapter.createElement("p");
        el.setAttribute("class", "target");
        el.setAttribute(
          "lang",
          p.config.direction === "en-zh" ? "zh-CN" : "en",
        );
        el.appendChild(chapter.createTextNode(text));
        node.parentNode?.insertBefore(el, node.nextSibling);
        node.setAttribute(
          "lang",
          p.config.direction === "en-zh" ? "en" : "zh-CN",
        );
      } else {
        const textNodes: any[] = [];
        const collect = (n: any) => {
          for (const c of Array.from(n.childNodes) as any[]) {
            if (c.nodeType === 3 && c.data.trim()) textNodes.push(c);
            else if (c.nodeType === 1) collect(c);
          }
        };
        collect(node);
        const length = textNodes.reduce((n, c) => n + c.data.length, 0);
        let offset = 0;
        for (let i = 0; i < textNodes.length; i++) {
          const end =
            i === textNodes.length - 1
              ? text.length
              : offset +
                Math.round(
                  (textNodes[i].data.length / Math.max(length, 1)) *
                    text.length,
                );
          textNodes[i].data = text.slice(offset, end);
          offset = end;
        }
        if (!textNodes.length) node.appendChild(chapter.createTextNode(text));
        node.setAttribute(
          "lang",
          p.config.direction === "en-zh" ? "zh-CN" : "en",
        );
      }
    }
    const head = chapter.getElementsByTagName("head")[0];
    const style = chapter.createElement("style");
    style.appendChild(chapter.createTextNode(css));
    head.appendChild(style);
    const title = chapter.getElementsByTagName("title")[0];
    const heading = p.doc.blocks.find(
      (b) => b.sectionId === s.id && b.type === "heading",
    );
    const translatedTitle = heading ? txt(p, heading) : s.title;
    if (title) title.textContent = translatedTitle;
    files[path] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        serializer.serializeToString(chapter),
    );
    manifest.push(
      `<item id="c${s.order}" href="${escapeHtml(path)}" media-type="application/xhtml+xml"/>`,
    );
    spine.push(`<itemref idref="c${s.order}"/>`);
    nav.push(
      `<li><a href="${escapeHtml(path)}">${escapeHtml(translatedTitle)}</a></li>`,
    );
  }
  for (let i = 0; i < p.doc.resources.length; i++) {
    const r = p.doc.resources[i];
    if (r.mime.startsWith("image/"))
      manifest.push(
        `<item id="r${i}" href="${escapeHtml(r.path)}" media-type="${r.mime}"${r.path === p.doc.coverPath ? ' properties="cover-image"' : ""}/>`,
      );
  }
  files["nav.xhtml"] = strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol>${nav.join("")}</ol></nav></body></html>`,
  );
  files["report.xhtml"] = strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>翻译说明</title></head><body><h1>翻译说明</h1><p>原标题：${escapeHtml(p.doc.title)}。${bilingual ? "双语版" : "译文版"}，由译页生成，模型 ${escapeHtml(p.config.model)}。未完成内容标记【未翻译】。</p>${p.doc.warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join("")}</body></html>`,
  );
  files["package.opf"] = strToU8(
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${p.id}</dc:identifier><dc:title>${escapeHtml(p.doc.title)} · ${bilingual ? "双语版" : "译文"}</dc:title><dc:creator>${escapeHtml(p.doc.author || "Unknown")}</dc:creator><dc:language>${p.config.direction === "en-zh" ? "zh-CN" : "en"}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta></metadata><manifest>${manifest.join("")}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="report" href="report.xhtml" media-type="application/xhtml+xml"/></manifest><spine>${spine.join("")}<itemref idref="report"/></spine></package>`,
  );
  // Reconcile every retained internal link. Missing original nav/non-spine links become plain text.
  for (const s of sections) {
    const path = s.path!;
    const chapter = parser.parseFromString(
      strFromU8(files[path] as Uint8Array),
      "application/xml",
    );
    for (const a of Array.from(chapter.getElementsByTagName("a"))) {
      const href = a.getAttribute("href");
      if (!href) continue;
      try {
        const target = href.startsWith("#") ? path : resolvePath(path, href);
        if (!(target in files)) a.removeAttribute("href");
      } catch {
        a.removeAttribute("href");
      }
    }
    files[path] = strToU8(serializer.serializeToString(chapter));
  }
  return zipSync(files);
}
export async function createBackup(p: Project) {
  const files: Record<string, Uint8Array> = { "source.bin": p.source };
  const resources = p.doc.resources.map((r, i) => {
    files[`resources/${i}.bin`] = r.data;
    return { path: r.path, mime: r.mime, file: `resources/${i}.bin` };
  });
  const { source: _, doc, ...rest } = p;
  files["project.json"] = strToU8(
    JSON.stringify({ ...rest, doc: { ...doc, resources } }),
  );
  const checksums: Record<string, string> = {};
  for (const [path, data] of Object.entries(files))
    checksums[path] = await hash(data);
  files["manifest.json"] = strToU8(
    JSON.stringify({ schema_version: 1, application: "yiye", checksums }),
  );
  return zipSync(files);
}
export async function importBackup(bytes: Uint8Array): Promise<Project> {
  const files = await boundedUnzip(
    bytes,
    70 * 1024 * 1024,
    2100,
    70 * 1024 * 1024,
  );
  const manifest = JSON.parse(
    strFromU8(files["manifest.json"] || new Uint8Array()),
  );
  if (manifest.schema_version !== 1 || manifest.application !== "yiye")
    throw Error("项目包版本不受支持");
  if (!manifest.checksums || typeof manifest.checksums !== "object")
    throw Error("项目包校验信息缺失");
  for (const [path, checksum] of Object.entries(manifest.checksums)) {
    safePath(path);
    if (!files[path] || (await hash(files[path])) !== checksum)
      throw Error("项目包校验失败");
  }
  if (!manifest.checksums["project.json"] || !manifest.checksums["source.bin"])
    throw Error("项目包缺少必需校验");
  if (files["source.bin"].length > 10 * 1024 * 1024)
    throw Error("项目源文件超过 10 MiB 限制");
  const raw = JSON.parse(strFromU8(files["project.json"]));
  if (
    raw.schemaVersion !== 1 ||
    !raw.doc ||
    !Array.isArray(raw.doc.blocks) ||
    !Array.isArray(raw.doc.sections) ||
    !Array.isArray(raw.revisions) ||
    !Array.isArray(raw.attempts) ||
    !["pdf", "epub"].includes(raw.doc.format)
  )
    throw Error("项目包结构无效");
  if (
    raw.doc.blocks.length > 10000 ||
    raw.revisions.length > 50000 ||
    raw.attempts.length > 50000
  )
    throw Error("项目包项目数超限");
  const provider = raw.config?.provider;
  if (
    !(provider in providers) ||
    !providers[provider as keyof typeof providers].models.includes(
      raw.config.model,
    )
  )
    throw Error("项目包模型配置不在官方白名单内，请使用受支持的项目包");
  const resources = raw.doc.resources.map((r: any) => {
    safePath(r.path);
    if (
      !manifest.checksums[r.file] ||
      !files[r.file] ||
      ![
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/xhtml+xml",
      ].includes(r.mime)
    )
      throw Error("资源校验失败");
    if (
      r.mime === "application/xhtml+xml" &&
      /<script|\son\w+\s*=|<iframe|<object|<!ENTITY|<!DOCTYPE/i.test(
        strFromU8(files[r.file]),
      )
    )
      throw Error("项目包含不安全内容");
    if (r.mime === "application/xhtml+xml") {
      const chapter = new DOMParser().parseFromString(
        strFromU8(files[r.file]),
        "application/xml",
      );
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
      for (const node of Array.from(chapter.getElementsByTagName("*"))) {
        if (!allowed.has(node.localName || node.nodeName))
          throw Error("备份 XHTML 含不受支持的内容");
        for (const attr of Array.from(node.attributes)) {
          if (
            ![
              "xmlns",
              "xmlns:epub",
              "id",
              "href",
              "src",
              "alt",
              "title",
              "colspan",
              "rowspan",
              "lang",
              "xml:lang",
              "data-yiye-id",
            ].includes(attr.name)
          )
            throw Error("备份 XHTML 含不安全属性");
          if (["href", "src"].includes(attr.name)) {
            if (/^[a-z]+:|^\/\//i.test(attr.value))
              throw Error("备份不允许远程或活动链接");
            resolvePath(r.path, attr.value);
          }
        }
      }
    }
    return { path: r.path, mime: r.mime, data: files[r.file] };
  });
  const blocks = raw.doc.blocks.map((b: any) => {
    if (
      typeof b.id !== "string" ||
      typeof b.text !== "string" ||
      b.text.length > 10000 ||
      typeof b.sectionId !== "string" ||
      !["paragraph", "heading", "list", "code", "image", "unknown"].includes(
        b.type,
      )
    )
      throw Error("块数据无效");
    return {
      id: b.id,
      sectionId: b.sectionId,
      order: Number(b.order),
      type: b.type,
      text: b.text,
      locator: String(b.locator),
      flags: Array.isArray(b.flags) ? b.flags.map(String) : [],
      resource: b.resource ? safePath(b.resource) : undefined,
      anchor: b.anchor ? String(b.anchor) : undefined,
      level: Number(b.level) || undefined,
      spans: Array.isArray(b.spans)
        ? b.spans.map((s: any) => ({
            text: String(s.text),
            protected: !!s.protected,
            bold: !!s.bold,
            italic: !!s.italic,
          }))
        : undefined,
    };
  });
  if (new Set(blocks.map((b: any) => b.id)).size !== blocks.length)
    throw Error("重复块 ID");
  const config = { ...defaultConfig };
  for (const key of Object.keys(config) as (keyof typeof config)[]) {
    if (raw.config[key] !== undefined) (config as any)[key] = raw.config[key];
  }
  if (
    !["en-zh", "zh-en"].includes(config.direction) ||
    !["faithful", "natural", "technical"].includes(config.style) ||
    !Array.isArray(config.glossary) ||
    config.glossary.length > 500
  )
    throw Error("项目配置无效");
  config.glossary = config.glossary.map((t: any) => ({
    source: String(t.source).slice(0, 200),
    target: String(t.target).slice(0, 200),
    direction: t.direction,
    case_sensitive: !!t.case_sensitive,
    match_mode: t.match_mode,
    note: String(t.note || "").slice(0, 200),
  }));
  for (const k of ["budget", "maxRequests", "maxTokens"] as const) {
    if (!Number.isFinite(config[k]) || config[k] <= 0)
      throw Error("项目限额无效");
  }
  for (const k of ["inputPrice", "outputPrice"] as const) {
    if (config[k] !== null && (!Number.isFinite(config[k]) || config[k]! < 0))
      throw Error("价格无效");
  }
  if ((await hash(files["source.bin"])) !== raw.doc.fileHash && !raw.demo)
    throw Error("源文件校验不符");
  const revisions = raw.revisions.map((r: any) => {
    if (
      !blocks.some((b: any) => b.id === r.blockId) ||
      typeof r.text !== "string" ||
      !["model", "manual", "candidate"].includes(r.origin)
    )
      throw Error("译稿数据无效");
    return {
      id: String(r.id),
      blockId: r.blockId,
      text: r.text,
      origin: r.origin,
      version: Number(r.version),
      createdAt: Number(r.createdAt),
      configHash: String(r.configHash),
    };
  });
  const attempts = raw.attempts.map((a: any) => {
    if (!["sent", "success", "failed", "unknown"].includes(a.state))
      throw Error("调用记录无效");
    return {
      id: String(a.id),
      blockId: String(a.blockId),
      state: a.state === "sent" ? "unknown" : a.state,
      sentAt: Number(a.sentAt),
      inputTokens: typeof a.inputTokens === "number" ? a.inputTokens : null,
      outputTokens: typeof a.outputTokens === "number" ? a.outputTokens : null,
      cost: typeof a.cost === "number" ? a.cost : null,
      reserved: Number(a.reserved) || 0,
      reservedTokens: Number(a.reservedTokens) || 0,
      error: a.error ? String(a.error) : undefined,
      configHash: String(a.configHash),
      priceVersion: String(a.priceVersion),
      currency: String(a.currency),
      inputPrice: a.inputPrice ?? null,
      outputPrice: a.outputPrice ?? null,
      epoch: Number(a.epoch) || 0,
    };
  });
  return {
    id: String(raw.id),
    name: String(raw.name),
    createdAt: Number(raw.createdAt),
    savedAt: Date.now(),
    expiresAt: raw.expiresAt ? Number(raw.expiresAt) : null,
    schemaVersion: 1,
    parseVersion: 1,
    epoch: (Number(raw.epoch) || 0) + 1,
    state: "interrupted",
    storage: "session",
    doc: {
      title: String(raw.doc.title),
      author: String(raw.doc.author || ""),
      format: raw.doc.format,
      fileHash: String(raw.doc.fileHash),
      sections: raw.doc.sections.map((s: any) => ({
        id: String(s.id),
        title: String(s.title),
        order: Number(s.order),
        path: s.path ? safePath(s.path) : undefined,
      })),
      blocks,
      resources,
      warnings: (raw.doc.warnings || []).map(String),
      pages: Number(raw.doc.pages) || 0,
      estimatedTokens: Number(raw.doc.estimatedTokens) || 0,
      coverPath: raw.doc.coverPath ? safePath(raw.doc.coverPath) : undefined,
    },
    source: files["source.bin"],
    config,
    revisions,
    attempts,
    completed: (raw.completed || []).filter((id: any) =>
      blocks.some((b: any) => b.id === id),
    ),
    errors: {},
    message: "已导入项目包。请重新测试连接，再手动继续。",
    configHash: String(raw.configHash),
    demo: !!raw.demo,
  };
}

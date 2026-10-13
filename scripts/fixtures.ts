import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
await mkdir("tests/fixtures", { recursive: true });
const sample =
  "Reading creates room for thought. We can understand unfamiliar ideas without agreeing with every sentence. Keep asking questions and compare the evidence.";
async function pdf(name: string, kind: string, pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    if (kind === "scan" || (kind === "mixed" && i === 1)) {
      page.drawRectangle({
        x: 40,
        y: 50,
        width: 510,
        height: 700,
        color: rgb(0.95, 0.95, 0.95),
      });
      continue;
    }
    if (kind === "double") {
      for (let y = 730; y > 450; y -= 25) {
        page.drawText("Left column text", { x: 40, y, size: 11, font });
        page.drawText("Right column text", { x: 345, y, size: 11, font });
      }
      continue;
    }
    page.drawText("A different way to read", { x: 48, y: 770, size: 22, font });
    let y = 725;
    const body =
      kind === "code"
        ? "const count = 42; E = mc^2; https://www.w3.org/"
        : sample;
    for (let j = 0; j < 5; j++) {
      const lines = body.match(/.{1,72}(?:\s|$)/g) || [body];
      for (const line of lines) {
        page.drawText(line.trim(), { x: 48, y, size: 11, font });
        y -= 20;
      }
      y -= 15;
    }
    if (kind === "table") {
      page.drawText("Table 1: original graphic", {
        x: 48,
        y: 270,
        size: 12,
        font,
      });
      page.drawRectangle({
        x: 48,
        y: 170,
        width: 400,
        height: 80,
        borderColor: rgb(0.1, 0.1, 0.1),
        borderWidth: 1,
      });
    }
  }
  await writeFile(`tests/fixtures/${name}.pdf`, await doc.save());
}
for (let i = 1; i <= 6; i++) await pdf(`single-${i}`, "single", i);
for (let i = 1; i <= 4; i++) await pdf(`double-${i}`, "double");
for (let i = 1; i <= 2; i++) await pdf(`table-${i}`, "table");
for (let i = 1; i <= 2; i++) await pdf(`code-${i}`, "code");
await pdf("scan", "scan");
await pdf("mixed", "mixed");
function epub(version: number, kind: string) {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    ),
    "OEBPS/book.opf": strToU8(
      `<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Reading across languages</dc:title><dc:creator>Yiye synthetic sample</dc:creator>${kind === "fixed" ? '<meta property="rendition:layout">pre-paginated</meta>' : ""}</metadata><manifest><item id="two" href="a.xhtml" media-type="application/xhtml+xml"/><item id="one" href="z.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
    ),
    "OEBPS/z.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First chapter</title></head><body><h1 id="first">First chapter</h1><p>${sample} <strong>Pay attention.</strong><a href="a.xhtml#footnote">1</a></p>${kind === "malicious" ? '<script>throw new Error("unsafe")</script><img src="https://example.invalid/track.png" onerror="alert(1)"/>' : ""}${kind === "missing" ? '<img src="missing.png"/>' : ""}</body></html>`,
    ),
    "OEBPS/a.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second chapter</title></head><body><h1>Second chapter</h1><p id="footnote">A useful footnote.</p><pre>const answer = 42;</pre></body></html>',
    ),
    "OEBPS/nav.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="z.xhtml">First chapter</a></nav></body></html>',
    ),
  };
  if (kind === "encrypted")
    files["META-INF/encryption.xml"] = strToU8("<encryption/>");
  return zipSync(files);
}
for (let i = 1; i <= 4; i++)
  await writeFile(
    `tests/fixtures/reflow-${i}.epub`,
    epub(i % 2 ? 2 : 3, "normal"),
  );
await writeFile("tests/fixtures/fixed.epub", epub(3, "fixed"));
await writeFile("tests/fixtures/missing.epub", epub(3, "missing"));
await writeFile("tests/fixtures/encrypted.epub", epub(3, "encrypted"));
await writeFile("tests/fixtures/corrupted.pdf", strToU8("%PDF-invalid"));
await writeFile("tests/fixtures/malicious.epub", epub(3, "malicious"));
await writeFile(
  "tests/fixtures/traversal.epub",
  zipSync({ "../../outside": strToU8("bad") }),
);
await writeFile(
  "tests/fixtures/bomb.epub",
  zipSync({ "huge.bin": new Uint8Array(2 * 1024 * 1024) }),
);
await writeFile(
  "tests/fixtures/README.md",
  "# 合成验证样本\n\n24 份基准样本：6 单栏 PDF、4 双栏、2 图表、2 公式代码、2 扫描/混合、4 可重排 EPUB 2/3、2 固定/缺资源、2 加密/损坏。另有恶意 EPUB、ZIP 路径穿越、压缩炸弹样本。由 scripts/fixtures.ts 生成，无用户内容。\n",
);

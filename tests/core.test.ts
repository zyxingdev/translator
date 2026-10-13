import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { parseCSV, protect, applicableTerms } from "../src/lib/glossary";
import { safePath, boundedUnzip, hash } from "../src/lib/security";
import { parseDocument } from "../src/lib/parser";
import { createDemo } from "../src/lib/demo";
import { createBackup, importBackup, exportProject } from "../src/lib/exporter";
import { checkBudget, totals, priceCost } from "../src/lib/controller";
import {
  db,
  putProject,
  mutateProject,
  saveManual,
  getProject,
  deleteProject,
  acquireLease,
  renewLease,
  releaseLease,
  applyConfig,
  configHash,
  recoverProject,
} from "../src/lib/store";
import { defaultConfig } from "../src/lib/types";
import { classifyError, normalizeUsage } from "../src/lib/providers";
const bytes = async (name: string) =>
  new Uint8Array(await readFile(`tests/fixtures/${name}`));
beforeEach(async () => {
  (globalThis as any).pdfjsWorker = await import(
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  await db.projects.clear();
  await db.leases.clear();
  await db.tombstones.clear();
});
describe("安全、术语与费用", () => {
  it("阻止路径穿越和远程 URL", () => {
    expect(() => safePath("../../x")).toThrow();
    expect(() => safePath("https://x")).toThrow();
    expect(safePath("OEBPS/a/../b")).toBe("OEBPS/b");
  });
  it("阻止 ZIP 炸弹、恶意路径和条目数", async () => {
    await expect(boundedUnzip(await bytes("bomb.epub"))).rejects.toThrow(
      /压缩比/,
    );
    await expect(boundedUnzip(await bytes("traversal.epub"))).rejects.toThrow();
    await expect(
      boundedUnzip(zipSync({ a: strToU8("a"), b: strToU8("b") }), 1000, 1),
    ).rejects.toThrow();
  });
  it("CSV 支持引号并拒绝冲突与错误方向", () => {
    const terms = parseCSV(
      'source,target,direction\n"attention, focus",专注,en-zh',
    );
    expect(terms[0].source).toBe("attention, focus");
    expect(() => parseCSV("source,target\nx,a\nx,b")).toThrow(/冲突/);
    expect(() => parseCSV("source,target,direction\nx,a,wrong")).toThrow();
  });
  it("词边界与最长术语优先", () => {
    const terms = parseCSV("source,target\nread,阅读\nreading room,阅览室");
    expect(
      applicableTerms("reading room", terms, "en-zh").map((t) => t.source),
    ).toEqual(["reading room"]);
  });
  it("占位符完整性和数字 URL 保护", () => {
    const p = protect("Read 42 books at https://www.w3.org/. `x = 3`");
    expect(p.text).not.toContain("Read 42 books");
    expect(p.restore(p.text)).toContain("42");
    expect(() => p.restore("lost")).toThrow();
    expect(() => p.restore(p.text + p.text)).toThrow();
  });
  it("usage 包含 Gemini 推理 tokens，网络鉴权分类明确", () => {
    expect(
      normalizeUsage("gemini", {
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 5,
        },
      }),
    ).toEqual({ input: 10, output: 25 });
    expect(classifyError(401).category).toBe("credential");
    expect(classifyError(429).category).toBe("rate");
  });
  it("已知价格正确计算，未知不归零，下一请求软预算拒绝", async () => {
    expect(priceCost(120000, 110000, 2, 8)).toBe(1.12);
    expect(priceCost(null, 100, 2, 8)).toBeNull();
    const p = await createDemo();
    p.config = { ...defaultConfig, budget: 1, inputPrice: 2, outputPrice: 8 };
    expect(() => checkBudget(p, 1.1, 100)).toThrow(/预算/);
    p.attempts.push({
      id: "a",
      blockId: "b",
      state: "unknown",
      sentAt: 0,
      inputTokens: null,
      outputTokens: null,
      cost: null,
      reserved: 0.9,
      reservedTokens: 100,
      configHash: "x",
      priceVersion: "x",
      currency: "USD",
      inputPrice: 2,
      outputPrice: 8,
      epoch: 0,
    });
    expect(totals(p).unknown).toBe(1);
    expect(() => checkBudget(p, 0.2, 100)).toThrow(/预算/);
  });
});
describe("EPUB 解析、导出与备份", () => {
  it.each([1, 2, 3, 4])("EPUB %i 按 spine 而非文件名排序", async (i) => {
    const d = await parseDocument(
      await bytes(`reflow-${i}.epub`),
      `reflow-${i}.epub`,
      false,
      () => {},
    );
    expect(d.sections[0].title).toBe("First chapter");
    expect(d.sections[1].title).toBe("Second chapter");
    expect(d.blocks.some((b) => b.type === "code")).toBe(true);
  });
  it("固定版式、加密、损坏签名拒绝，缺资源显式报告", async () => {
    for (const file of ["fixed.epub", "encrypted.epub", "corrupted.pdf"])
      await expect(
        parseDocument(await bytes(file), file, false, () => {}),
      ).rejects.toThrow();
    const doc = await parseDocument(
      await bytes("missing.epub"),
      "missing.epub",
      false,
      () => {},
    );
    expect(doc.warnings.join("")).toContain("图片未加载");
  });
  it("脚本、事件和远程图像被移除", async () => {
    const doc = await parseDocument(
      await bytes("malicious.epub"),
      "malicious.epub",
      false,
      () => {},
    );
    expect(doc.resources.map((r) => strFromU8(r.data)).join("")).not.toMatch(
      /<script|onerror|https:\/\/example/,
    );
  });
  it("项目备份往返和损坏检测，无 Key 字段", async () => {
    const p = await createDemo();
    const out = await createBackup(p);
    const restored = await importBackup(out);
    expect(restored.doc.blocks).toHaveLength(p.doc.blocks.length);
    expect(restored.revisions).toEqual(p.revisions);
    const files = unzipSync(out);
    expect(strFromU8(files["project.json"])).not.toMatch(
      /apiKey|Authorization|Bearer/,
    );
    files["source.bin"] = strToU8("tamper");
    await expect(importBackup(zipSync(files))).rejects.toThrow(/校验/);
  });
  it("HTML 译文转义，无脚本执行，未翻译明确标记", async () => {
    const p = await createDemo();
    p.revisions = [];
    p.doc.blocks[0].text = "<script>alert(1)</script>";
    const result = await exportProject(p, "html", false, () => {});
    const html = strFromU8(unzipSync(result.bytes)["translation.html"]);
    expect(html).toContain("【未翻译】");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("EPUB 导出保留目录与脚注锚点", async () => {
    const p = await createDemo();
    p.doc = await parseDocument(
      await bytes("reflow-1.epub"),
      "reflow-1.epub",
      false,
      () => {},
    );
    p.revisions = p.doc.blocks
      .filter((b) => b.type !== "code")
      .map((b) => ({
        id: b.id,
        blockId: b.id,
        text: "译文 " + b.text,
        origin: "model",
        version: 1,
        createdAt: 0,
        configHash: "x",
      }));
    const out = await exportProject(p, "epub", true, () => {});
    const files = unzipSync(out.bytes);
    expect(strFromU8(files["mimetype"])).toBe("application/epub+zip");
    expect(strFromU8(files["OEBPS/a.xhtml"])).toContain('id="footnote"');
    expect(strFromU8(files["nav.xhtml"])).toContain("OEBPS/z.xhtml");
    expect(strFromU8(files["package.opf"])).toContain('version="3.0"');
  });
});
describe("本机事务与锁", () => {
  it("人工稿保存，旧 epoch 拒绝，删除后禁止迟到写入", async () => {
    const p = await createDemo();
    p.storage = "local";
    await putProject(p);
    await saveManual(p.id, p.doc.blocks[0].id, "人工译稿");
    expect((await getProject(p.id))?.revisions.at(-1)?.text).toBe("人工译稿");
    await expect(
      mutateProject(p.id, (x) => (x.name = "bad"), 99),
    ).rejects.toThrow();
    await deleteProject(p.id);
    await expect(
      mutateProject(p.id, (x) => (x.name = "revive")),
    ).rejects.toThrow();
    await expect(putProject(p)).rejects.toThrow();
  });
  it("跨标签租约阻止第二执行，并校验 fencing token", async () => {
    const epoch = await acquireLease("global");
    await db.leases.update("global", { tab: "other-tab" });
    await expect(acquireLease("global")).rejects.toThrow(/另一标签/);
    await expect(renewLease("global", epoch)).rejects.toThrow(/失效/);
    await db.leases.delete("global");
    const next = await acquireLease("global");
    await releaseLease("global", next);
    expect(await db.leases.get("global")).toBeUndefined();
  });
  it("提交失败保留旧持久数据", async () => {
    const p = await createDemo();
    p.storage = "local";
    await putProject(p);
    await expect(
      mutateProject(p.id, (x) => {
        x.name = "new";
        throw Error("QuotaExceededError");
      }),
    ).rejects.toThrow();
    expect((await getProject(p.id))?.name).toBe(p.name);
  });
});
describe("PDF 样本矩阵", () => {
  it.each([1, 2, 3, 4, 5, 6])("单栏 PDF %i 解析完整", async (i) => {
    const doc = await parseDocument(
      await bytes(`single-${i}.pdf`),
      `single-${i}.pdf`,
      false,
      () => {},
    );
    expect(doc.pages).toBe(i);
    expect(
      doc.blocks.filter((b) => b.type === "paragraph").length,
    ).toBeGreaterThan(0);
    expect(doc.warnings).toHaveLength(0);
  });
  it.each([1, 2, 3, 4])("双栏 PDF %i 拒绝不可靠顺序", async (i) => {
    await expect(
      parseDocument(
        await bytes(`double-${i}.pdf`),
        `double-${i}.pdf`,
        false,
        () => {},
      ),
    ).rejects.toThrow(/多栏/);
  });
  it.each([1, 2])("图表 PDF %i 明确降级", async (i) => {
    const doc = await parseDocument(
      await bytes(`table-${i}.pdf`),
      `table-${i}.pdf`,
      false,
      () => {},
    );
    expect(doc.warnings.join("")).toContain("图形");
  });
  it.each([1, 2])("公式代码 PDF %i 不静默遗漏", async (i) => {
    const doc = await parseDocument(
      await bytes(`code-${i}.pdf`),
      `code-${i}.pdf`,
      false,
      () => {},
    );
    expect(doc.blocks.map((b) => b.text).join("")).toContain("42");
  });
  it("扫描拒绝，混合扫描标注页范围", async () => {
    await expect(
      parseDocument(await bytes("scan.pdf"), "scan.pdf", false, () => {}),
    ).rejects.toThrow(/没有可识别/);
    const doc = await parseDocument(
      await bytes("mixed.pdf"),
      "mixed.pdf",
      false,
      () => {},
    );
    expect(doc.warnings.join("")).toContain("第 2 页无可提取文本");
  });
  it("中文 PDF 输出含有效字体并可提取中文", async () => {
    const p = await createDemo();
    const font = new Uint8Array(await readFile("public/fonts/NotoSansSC.ttf"));
    const result = await exportProject(p, "pdf", true, () => {}, font);
    expect(result.bytes.slice(0, 5)).toEqual(strToU8("%PDF-"));
    const doc = await parseDocument(
      result.bytes,
      "translated.pdf",
      false,
      () => {},
    );
    expect(doc.blocks.map((b) => b.text).join("")).toContain("专注");
  }, 30000);
});
describe("翻译任务控制与模拟 API", () => {
  async function task() {
    const p = await createDemo();
    p.demo = false;
    p.doc.format = "epub";
    p.revisions = [];
    p.completed = [];
    p.storage = "local";
    p.state = "ready";
    p.config = { ...defaultConfig, inputPrice: 1, outputPrice: 1, budget: 5 };
    await putProject(p);
    return p;
  }
  const apiResponse = (body: any) => {
    const b = JSON.parse(body.messages[1].content);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                block_id: b.block_id,
                text: "译文 " + b.text,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 80 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  beforeEach(() => {
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("navigator", {});
  });
  it("试译三块、继续复用已提交块，费用包含试译", async () => {
    const p = await task();
    const fetch = vi.fn(async (_url, options) =>
      apiResponse(JSON.parse(options.body)),
    );
    vi.stubGlobal("fetch", fetch);
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    await controller.run(
      p.id,
      "synthetic-test-key",
      "deepseek:deepseek-flash",
      "trial",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await getProject(p.id))?.completed).toHaveLength(3);
    await controller.run(
      p.id,
      "synthetic-test-key",
      "deepseek:deepseek-flash",
      "all",
    );
    expect(fetch).toHaveBeenCalledTimes(7);
    const saved = (await getProject(p.id))!;
    expect(saved.completed).toHaveLength(7);
    expect(saved.state).toBe("completed");
    expect(totals(saved).known).toBeCloseTo(0.00126);
    vi.unstubAllGlobals();
  });
  it("网络未知停止，重开不自动重试或归零", async () => {
    const p = await task();
    const fetch = vi.fn(async () => {
      throw TypeError("network");
    });
    vi.stubGlobal("fetch", fetch);
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    await controller.run(p.id, "synthetic-test-key", "deepseek:deepseek-flash");
    expect(fetch).toHaveBeenCalledTimes(1);
    await controller.run(p.id, "synthetic-test-key", "deepseek:deepseek-flash");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await getProject(p.id))?.attempts[0].state).toBe("unknown");
    vi.unstubAllGlobals();
  });
  it("暂停处理在途结果后不再发送请求", async () => {
    const p = await task();
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    const fetch = vi.fn(async (_url, options) => {
      controller.pause();
      return apiResponse(JSON.parse(options.body));
    });
    vi.stubGlobal("fetch", fetch);
    await controller.run(p.id, "synthetic-test-key", "deepseek:deepseek-flash");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await getProject(p.id))?.completed).toHaveLength(1);
    expect((await getProject(p.id))?.state).toBe("paused");
    vi.unstubAllGlobals();
  });
  it("编辑与重译返回同时发生时保留人工稿及候选", async () => {
    const p = await task();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        await saveManual(p.id, p.doc.blocks[0].id, "我的人工稿");
        return apiResponse(JSON.parse(options.body));
      }),
    );
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    await controller.run(
      p.id,
      "synthetic-test-key",
      "deepseek:deepseek-flash",
      "retry",
      p.doc.blocks[0].id,
    );
    const saved = (await getProject(p.id))!;
    expect(saved.revisions.find((r) => r.origin === "manual")?.text).toBe(
      "我的人工稿",
    );
    expect(saved.revisions.at(-1)?.origin).toBe("candidate");
    vi.unstubAllGlobals();
  });
  it("供应商返回后存储失败停止，保留应急结果", async () => {
    const p = await task();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        vi.spyOn(db.projects, "put").mockRejectedValueOnce(
          Error("QuotaExceededError"),
        );
        return apiResponse(JSON.parse(options.body));
      }),
    );
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    await controller.run(p.id, "synthetic-test-key", "deepseek:deepseek-flash");
    expect(controller.emergencyProject?.revisions).toHaveLength(1);
    expect((await getProject(p.id))?.completed).toHaveLength(0);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("删除项目后迟到结果不会复活", async () => {
    const p = await task();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        await deleteProject(p.id);
        return apiResponse(JSON.parse(options.body));
      }),
    );
    const { TranslationController } = await import("../src/lib/controller");
    const controller = new TranslationController(
      () => {},
      () => {},
    );
    await controller.run(p.id, "synthetic-test-key", "deepseek:deepseek-flash");
    expect(await getProject(p.id)).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("配置与恢复边界", () => {
  it("仅预算变更保留完成检查点，翻译配置变更开启新版本", async () => {
    const p = await createDemo();
    p.storage = "local";
    p.configHash = await configHash(p.config);
    await putProject(p);
    let updated = await applyConfig(p.id, { ...p.config, budget: 10 });
    expect(updated.completed).toHaveLength(p.completed.length);
    expect(updated.config.budget).toBe(10);
    updated = await applyConfig(p.id, { ...p.config, direction: "zh-en" });
    expect(updated.completed).toHaveLength(0);
    expect(updated.revisions).toHaveLength(p.revisions.length);
  });
  it("租约过期后恢复为中断并保留已提交结果", async () => {
    const p = await createDemo();
    p.storage = "local";
    p.state = "running";
    await putProject(p);
    const restored = await recoverProject(p.id);
    expect(restored?.state).toBe("interrupted");
    expect(restored?.completed).toEqual(p.completed);
  });
  it("活动标签运行时，另一个标签读取不修改任务", async () => {
    const p = await createDemo();
    p.storage = "local";
    p.state = "running";
    await putProject(p);
    await db.leases.put({
      id: "global-translation",
      tab: "other",
      epoch: 1,
      expires: Date.now() + 10000,
    });
    expect((await recoverProject(p.id))?.state).toBe("running");
  });
});

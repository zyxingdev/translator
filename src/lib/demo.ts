import { type Project, uid, defaultConfig } from "./types";
import { hash } from "./security";
export async function createDemo(): Promise<Project> {
  const texts = [
    ["The Art of Paying Attention", "专注的艺术"],
    ["A different way to read", "换一种方式阅读"],
    [
      "Reading is more than the movement of our eyes across a page. It is a conversation between what we already know and what we are about to discover. Every book offers a small invitation: slow down, stay curious, and let an unfamiliar idea find its place.",
      "阅读不只是目光在纸页间的移动，它是已有认知与即将发现的事物之间的一场对话。每一本书都发出一个小小的邀请：慢下来，保持好奇，让陌生的想法找到自己的位置。",
    ],
    [
      "In a world of constant notifications, attention has become something we need to practice. A quiet hour with a book creates room for thought. We do not have to agree with every sentence; we only need to give it enough space to be understood.",
      "在通知不断涌来的世界里，专注成为一种需要练习的能力。安静地读一小时书，能为思考腾出空间。我们不必同意每一句话，只需留出足够的余地去理解它。",
    ],
    ["Beyond the familiar", "走出熟悉的边界"],
    [
      "A text written in another language carries another way of seeing. Translation opens a door, but thoughtful reading takes us through it. Keep a pencil nearby. Ask questions in the margins. Return to the passages that make you pause.",
      "另一种语言的文字，承载着另一种看待世界的方式。翻译打开一扇门，而用心阅读带我们走进门内。不妨在手边放一支笔，在页边写下问题，再次读那些让你停下来的段落。",
    ],
    [
      "The goal is not to finish more books. The goal is to notice more: an unexpected connection, a precise word, a question worth carrying into tomorrow.",
      "目标不在于读完更多书，而在于发现更多：一个意外的联系，一个精准的词语，一个值得带到明天的问题。",
    ],
  ];
  const id = uid();
  const now = Date.now();
  return {
    id,
    name: "The Art of Paying Attention",
    createdAt: now,
    savedAt: now,
    expiresAt: null,
    schemaVersion: 1,
    parseVersion: 1,
    epoch: 0,
    state: "completed",
    storage: "session",
    demo: true,
    doc: {
      title: "The Art of Paying Attention",
      author: "译页 · 合成演示文本",
      format: "pdf",
      fileHash: await hash(new Uint8Array()),
      sections: [
        { id: "s1", title: "A different way to read", order: 0 },
        { id: "s2", title: "Beyond the familiar", order: 1 },
      ],
      blocks: texts.map(([text], i) => ({
        id: `demo-${i}`,
        sectionId: i < 4 ? "s1" : "s2",
        order: i,
        type: [0, 1, 4].includes(i) ? "heading" : "paragraph",
        text,
        locator: `演示文本 · 段 ${i + 1}`,
        flags: [],
      })),
      resources: [],
      warnings: ["内置合成演示文档，译稿预先编写；没有发送任何模型请求。"],
      pages: 2,
      estimatedTokens: 380,
    },
    source: new Uint8Array(),
    config: { ...defaultConfig },
    configHash: "demo",
    revisions: texts.map(([, text], i) => ({
      id: uid(),
      blockId: `demo-${i}`,
      text,
      origin: "model",
      version: 1,
      createdAt: now,
      configHash: "demo",
    })),
    attempts: [],
    completed: texts.map((_, i) => `demo-${i}`),
    errors: {},
    message: "内置演示译稿 · 未使用 API，不产生模型费用",
  };
}

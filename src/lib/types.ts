export type Provider = "deepseek" | "glm" | "gemini" | "openai";
export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "code"
  | "image"
  | "unknown";
export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  anchor?: string;
  protected?: boolean;
}
export interface Block {
  id: string;
  sectionId: string;
  order: number;
  type: BlockType;
  text: string;
  locator: string;
  spans?: InlineSpan[];
  resource?: string;
  anchor?: string;
  level?: number;
  flags: string[];
}
export interface Section {
  id: string;
  title: string;
  order: number;
  path?: string;
}
export interface Resource {
  path: string;
  mime: string;
  data: Uint8Array;
}
export interface DocumentIR {
  title: string;
  author: string;
  format: "pdf" | "epub";
  fileHash: string;
  sections: Section[];
  blocks: Block[];
  resources: Resource[];
  warnings: string[];
  pages: number;
  estimatedTokens: number;
  coverPath?: string;
}
export interface Term {
  source: string;
  target: string;
  direction: "en-zh" | "zh-en" | "both";
  case_sensitive: boolean;
  match_mode: "word" | "substring";
  note: string;
}
export interface Config {
  provider: Provider;
  model: string;
  direction: "en-zh" | "zh-en";
  style: "faithful" | "natural" | "technical";
  glossary: Term[];
  background: string;
  maxRequests: number;
  maxTokens: number;
  budget: number;
  currency: "USD" | "CNY";
  inputPrice: number | null;
  outputPrice: number | null;
  priceVersion: string;
  promptVersion: number;
}
export type State =
  | "ready"
  | "running"
  | "paused"
  | "interrupted"
  | "completed"
  | "canceled"
  | "error";
export interface Revision {
  id: string;
  blockId: string;
  text: string;
  origin: "model" | "manual" | "candidate";
  version: number;
  createdAt: number;
  configHash: string;
}
export interface Attempt {
  id: string;
  blockId: string;
  state: "sent" | "success" | "failed" | "unknown";
  sentAt: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  reserved: number;
  reservedTokens: number;
  error?: string;
  configHash: string;
  priceVersion: string;
  currency: string;
  inputPrice: number | null;
  outputPrice: number | null;
  epoch: number;
}
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  expiresAt: number | null;
  schemaVersion: 1;
  parseVersion: 1;
  epoch: number;
  state: State;
  storage: "local" | "session";
  doc: DocumentIR;
  source: Uint8Array;
  config: Config;
  revisions: Revision[];
  attempts: Attempt[];
  completed: string[];
  errors: Record<string, string>;
  message: string;
  configHash: string;
  demo?: boolean;
}
export const defaultConfig: Config = {
  provider: "deepseek",
  model: "deepseek-flash",
  direction: "en-zh",
  style: "faithful",
  glossary: [],
  background: "",
  maxRequests: 200,
  maxTokens: 250000,
  budget: 5,
  currency: "USD",
  inputPrice: null,
  outputPrice: null,
  priceVersion: "unknown-2026-10-13",
  promptVersion: 1,
};
export const uid = () => crypto.randomUUID();
export const estimateTokens = (s: string) =>
  Math.ceil(
    [...s].reduce((n, c) => n + (/[\u3400-\u9fff]/.test(c) ? 1 : 0.32), 0),
  );
export const selectedRevision = (p: Project, id: string) =>
  p.revisions
    .filter((r) => r.blockId === id && r.origin !== "candidate")
    .at(-1);
export const translatable = (b: Block) =>
  !["image", "code"].includes(b.type) && !!b.text.trim();
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试。";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Plus,
  FolderOpen,
  Settings,
  ArrowUpRight,
  ArrowRight,
  FileText,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Upload,
  Languages,
  Check,
  Clock,
  MoreHorizontal,
  Search,
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  KeyRound,
  Eye,
  EyeOff,
  X,
  PanelLeft,
  Info,
  Globe,
  Loader2,
  HardDrive,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  SlidersHorizontal,
  FileArchive,
  Leaf,
  Link,
  Sun,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input, Textarea } from "./components/ui/input";
import {
  type Project,
  type Config,
  type DocumentIR,
  type Provider,
  type Block,
  defaultConfig,
  uid,
  errorMessage,
  selectedRevision,
  translatable,
} from "./lib/types";
import {
  listProjects,
  getProject,
  recoverProject,
  putProject,
  deleteProject,
  clearProjects,
  storageCheck,
  configHash,
  applyConfig,
  saveManual,
  acceptCandidate,
  channel,
  mutateProject,
  db,
} from "./lib/store";
import { workerCall } from "./lib/worker";
import { providers, testConnection } from "./lib/providers";
import {
  TranslationController,
  totals,
  acknowledgeUnknown,
  priceCost,
  checkBudget,
} from "./lib/controller";
import { parseCSV } from "./lib/glossary";
import { createDemo } from "./lib/demo";
function route() {
  const [page, id] = location.hash.slice(2).split("/");
  return { page: page || "home", id };
}
const navigate = (page: string) => {
  location.hash = "/" + page;
};
const formatDate = (n: number) =>
  new Date(n).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal modal-wide" : "modal"}
      onCancel={onClose}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
          <X size={19} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
function ConfigFields({
  config,
  setConfig,
  disabled = false,
}: {
  config: Config;
  setConfig: (c: Config) => void;
  disabled?: boolean;
}) {
  const patch = (c: Partial<Config>) => setConfig({ ...config, ...c });
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <fieldset disabled={disabled} className="config-fields">
      <div className="form-grid">
        <Select
          label="翻译方向"
          value={config.direction}
          onChange={(v) => patch({ direction: v as Config["direction"] })}
        >
          <option value="en-zh">英文 → 简体中文</option>
          <option value="zh-en">中文 → 英文</option>
        </Select>
        <Select
          label="译文风格"
          value={config.style}
          onChange={(v) => patch({ style: v as Config["style"] })}
        >
          <option value="faithful">忠实 · 准确保留原意</option>
          <option value="natural">自然 · 流畅易读</option>
          <option value="technical">技术 · 严谨专业</option>
        </Select>
      </div>
      <label className="field">
        <span>选择模型供应商</span>
        <div className="provider-grid">
          {(Object.keys(providers) as Provider[]).map((v) => (
            <button
              type="button"
              key={v}
              onClick={() =>
                patch({
                  provider: v,
                  model: providers[v].models[0],
                  inputPrice: null,
                  outputPrice: null,
                  priceVersion: "unknown-2026-10-13",
                })
              }
              className={`provider-option ${config.provider === v ? "selected" : ""}`}
            >
              <span className={`provider-mark mark-${v}`}>
                {v === "deepseek"
                  ? "D"
                  : v === "glm"
                    ? "智"
                    : v === "gemini"
                      ? "✦"
                      : "◎"}
              </span>
              <strong>{providers[v].name}</strong>
              {config.provider === v && <Check size={14} />}
            </button>
          ))}
        </div>
      </label>
      <Select
        label="模型（官方清单核查：2026-10-13；可用性仍需测试）"
        value={config.model}
        onChange={(v) => patch({ model: v })}
      >
        {providers[config.provider].models.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </Select>
      <div className="field">
        <span>
          术语表 <small>可选 · 最多 500 条</small>
        </span>
        <div className="inline-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => file.current?.click()}
          >
            <Upload size={14} />
            导入 CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              download(
                new TextEncoder().encode(
                  "source,target,direction,case_sensitive,match_mode,note\nattention,专注,en-zh,false,word,\n",
                ),
                "text/csv",
                "译页-术语模板.csv",
              )
            }
          >
            下载模板
          </Button>
          <span className="muted">{config.glossary.length} 条术语</span>
          {config.glossary.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patch({ glossary: [] })}
            >
              清空
            </Button>
          )}
        </div>
        <input
          hidden
          type="file"
          accept=".csv"
          ref={file}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                if (f.size > 300000) throw Error("CSV 超过大小限制");
                patch({ glossary: parseCSV(await f.text()) });
                setError("");
              } catch (e) {
                setError(errorMessage(e));
              }
            }
            e.target.value = "";
          }}
        />
        {error && <p className="error-text">{error}</p>}
      </div>
      <label className="field">
        <span>
          文档背景 <small>可选</small>
        </span>
        <Textarea
          maxLength={1500}
          rows={2}
          value={config.background}
          onChange={(e) => patch({ background: e.target.value })}
          placeholder="例如：认知科学论文，保留专业术语与引用格式"
        />
      </label>
      <details className="advanced">
        <summary>
          <SlidersHorizontal size={15} />
          预算与请求限制
          <ChevronDown size={14} />
        </summary>
        <p className="fine-print">
          价格默认未知，只启用请求 / token
          限制。手动填写官方单价后可启用金额软预算，最终账单以供应商为准。
        </p>
        <div className="form-grid">
          <label className="field">
            <span>最多请求次数</span>
            <Input
              type="number"
              min={1}
              max={5000}
              value={config.maxRequests}
              onChange={(e) =>
                patch({ maxRequests: Math.max(1, Number(e.target.value)) })
              }
            />
          </label>
          <label className="field">
            <span>token 软限制</span>
            <Input
              type="number"
              min={1000}
              value={config.maxTokens}
              onChange={(e) =>
                patch({ maxTokens: Math.max(1000, Number(e.target.value)) })
              }
            />
          </label>
          <Select
            label="币种"
            value={config.currency}
            onChange={(v) => patch({ currency: v as Config["currency"] })}
          >
            <option>USD</option>
            <option>CNY</option>
          </Select>
          <label className="field">
            <span>本地金额软预算</span>
            <Input
              type="number"
              min={0.01}
              step="0.1"
              value={config.budget}
              onChange={(e) =>
                patch({ budget: Math.max(0.01, Number(e.target.value)) })
              }
            />
          </label>
          {(["inputPrice", "outputPrice"] as const).map((k) => (
            <label key={k} className="field">
              <span>{k === "inputPrice" ? "输入" : "输出"} / 百万 tokens</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={config[k] ?? ""}
                placeholder="未知"
                onChange={(e) =>
                  patch({
                    [k]:
                      e.target.value === ""
                        ? null
                        : Math.max(0, Number(e.target.value)),
                    priceVersion:
                      "manual-" + new Date().toISOString().slice(0, 10),
                  })
                }
              />
            </label>
          ))}
        </div>
        <a
          href={providers[config.provider].help}
          target="_blank"
          rel="noreferrer"
        >
          查看供应商官方文档 <ExternalLink size={12} />
        </a>
      </details>
    </fieldset>
  );
}
function download(bytes: Uint8Array, mime: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: mime }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const labels: Record<string, string> = {
  ready: "待翻译",
  running: "翻译中",
  paused: "已暂停",
  interrupted: "待恢复",
  completed: "已完成",
  canceled: "已取消",
  error: "需处理",
};
export default function App() {
  const [readerLimit, setLimit] = useState(30);
  const [locationState, setLocationState] = useState(route);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<Config>({ ...defaultConfig });
  const [apiKey, setApiKey] = useState("");
  const keyRef = useRef("");
  const [verified, setVerified] = useState("");
  const [diagnostic, setDiagnostic] = useState<
    {
      provider: Provider;
      model: string;
      origin: string;
      date: number;
      success: boolean;
      message: string;
      tokens: number | null;
    }[]
  >([]);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");
  const [storage, setStorage] = useState<"local" | "session">("session");
  const [persistentConsent, setPersistentConsent] = useState(false);
  const [partialConsent, setPartialConsent] = useState(false);
  const [bilingual, setBilingual] = useState(true);
  const [exportFormat, setExportFormat] = useState("html");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [retention, setRetention] = useState("7");
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const workAbort = useRef<AbortController | undefined>(undefined);
  const controller = useRef<TranslationController | undefined>(undefined);
  const currentProject = useRef<Project | null>(null);
  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      setError(
        "本机数据库不可用。可选择仅本次会话；恢复与多标签保护需要可写 IndexedDB。",
      );
    }
  }, []);
  useEffect(() => {
    controller.current = new TranslationController((p) => {
      if (currentProject.current?.id === p.id) {
        currentProject.current = p;
        setProject(p);
      }
      void refresh();
    }, setError);
    void refresh();
    const handler = () => {
      setLocationState(route());
      setSidebarOpen(false);
      setSection("all");
      setSearch("");
      setLimit(30);
    };
    window.addEventListener("hashchange", handler);
    const update = async (e: MessageEvent) => {
      await refresh();
      if (
        e.data.id === currentProject.current?.id &&
        !controller.current?.isRunning
      ) {
        const p = await getProject(e.data.id);
        setProject(p || null);
        currentProject.current = p || null;
      }
    };
    channel?.addEventListener("message", update);
    const hidden = () => {
      if (document.hidden) controller.current?.pause();
    };
    document.addEventListener("visibilitychange", hidden);
    const unload = (e: BeforeUnloadEvent) => {
      if (
        controller.current?.isRunning ||
        (currentProject.current?.storage === "session" &&
          currentProject.current &&
          !currentProject.current.demo)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("hashchange", handler);
      channel?.removeEventListener("message", update);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", unload);
    };
  }, [refresh]);
  useEffect(() => {
    if (locationState.page === "project" && locationState.id) {
      void recoverProject(locationState.id).then((p) => {
        if (p) {
          setProject(p);
          currentProject.current = p;
          setConfig(p.config);
          setStorage(p.storage);
          setPersistentConsent(p.storage === "local");
        } else {
          setError("项目不存在或已清除，可导入项目备份。");
          navigate("projects");
        }
      });
    }
  }, [locationState]);
  useEffect(() => {
    keyRef.current = apiKey;
    setVerified("");
    if (controller.current?.isRunning) controller.current.cancel();
  }, [apiKey]);
  useEffect(() => {
    setVerified("");
  }, [config.provider, config.model]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const page = locationState.page;
  const active = controller.current?.isRunning || false;
  const allBlocks = project?.doc.blocks.filter(translatable) || [];
  const completed = project?.completed.length || 0;
  const percent = allBlocks.length
    ? Math.round((completed / allBlocks.length) * 100)
    : 0;
  const cost = project ? totals(project) : null;
  const notify = (message: string) => {
    setToast(message);
  };
  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProgress(0);
    setError("");
    workAbort.current = new AbortController();
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const create = async (file: File) => {
    if (controller.current?.isRunning) {
      setError("请先暂停当前任务，再选择新文档。");
      return;
    }
    await withBusy("正在本地解析", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await workerCall<DocumentIR>(
        "parse",
        {
          bytes,
          name: file.name,
          assetBase: new URL("./", document.baseURI).href,
          mobile: matchMedia("(max-width: 768px)").matches,
        },
        (n, label) => {
          setProgress(n);
          setBusy(label);
        },
        workAbort.current?.signal,
      );
      const sample = doc.blocks
        .map((b) => b.text)
        .join(" ")
        .slice(0, 12000);
      const chinese = (sample.match(/[\u3400-\u9fff]/g) || []).length;
      const words = (sample.match(/[a-zA-Z]+/g) || []).length;
      const detectedConfig = {
        ...config,
        direction: (chinese > words ? "zh-en" : "en-zh") as Config["direction"],
      };
      setConfig(detectedConfig);
      const now = Date.now();
      const p: Project = {
        id: uid(),
        name: doc.title,
        createdAt: now,
        savedAt: now,
        expiresAt: null,
        schemaVersion: 1,
        parseVersion: 1,
        epoch: 0,
        state: "ready",
        storage: "session",
        doc,
        source: bytes,
        config: structuredClone(detectedConfig),
        revisions: [],
        attempts: [],
        completed: [],
        errors: {},
        message: "文档已在本地解析，请检查报告并配置翻译。",
        configHash: await configHash(detectedConfig),
      };
      await putProject(p);
      setProject(p);
      currentProject.current = p;
      setStorage("session");
      setPersistentConsent(false);
      setPartialConsent(false);
      navigate("new");
      void refresh();
    });
  };
  const run = async (mode: "all" | "trial" | "retry", blockId?: string) => {
    if (!project) return;
    setError("");
    if (
      project.doc.warnings.some((w) => w.includes("无可提取文本")) &&
      !partialConsent
    ) {
      setError(
        "存在无法提取文本的页面，请先在解析报告中确认只翻译可识别部分。",
      );
      setModal("report");
      return;
    }
    if (storage === "local" && !persistentConsent) {
      setError("请先确认本机保存，或选择仅本次会话。");
      return;
    }
    try {
      let p = project;
      if (p.storage !== storage) {
        if (storage === "local")
          await storageCheck(
            p.source.length +
              p.doc.resources.reduce((n, r) => n + r.data.length, 0),
          );
        p = {
          ...p,
          storage,
          expiresAt:
            storage === "local" && retention === "7"
              ? Date.now() + 7 * 86400000
              : null,
        };
        await putProject(p);
        setProject(p);
      }
      if (JSON.stringify(config) !== JSON.stringify(p.config)) {
        if (p.attempts.length && config.currency !== p.config.currency)
          throw Error("已有用量记录时不能更改币种，请新建项目");
        p = await applyConfig(p.id, config);
        setProject(p);
      }
      navigate("project/" + p.id);
      await controller.current?.run(
        p.id,
        keyRef.current,
        verified,
        mode,
        blockId,
      );
      void refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const test = async () => {
    if (testing || active) return;
    if (!apiKey.trim()) {
      setError("请输入自己的 API Key。");
      return;
    }
    setTesting(true);
    setError("");
    const c = structuredClone(config);
    const key = apiKey;
    const projectId =
      currentProject.current && !currentProject.current.demo
        ? currentProject.current.id
        : undefined;
    let tokens = 0,
      success = false,
      message = "";
    let currentAttemptId = "";
    try {
      for (const direction of ["en-zh", "zh-en"] as const) {
        const reserve = priceCost(1000, 8192, c.inputPrice, c.outputPrice) ?? 0;
        const a: Project["attempts"][number] = {
          id: uid(),
          blockId: "connection-test",
          state: "sent",
          sentAt: Date.now(),
          inputTokens: null,
          outputTokens: null,
          cost: null,
          reserved: reserve,
          reservedTokens: 9192,
          configHash: "diagnostic",
          priceVersion: c.priceVersion,
          currency: c.currency,
          inputPrice: c.inputPrice,
          outputPrice: c.outputPrice,
          epoch: 0,
        };
        currentAttemptId = a.id;
        if (projectId) {
          const p = await mutateProject(projectId, (x) => {
            if (x.attempts.length && x.config.currency !== c.currency)
              throw Error("已有记录时请保持相同币种");
            checkBudget({ ...x, config: c }, reserve, 9192);
            x.attempts.push(a);
          });
          setProject(p);
          currentProject.current = p;
        }
        const result = await testConnection({ ...c, direction }, key);
        tokens += (result.usage.input || 0) + (result.usage.output || 0);
        if (projectId) {
          const p = await mutateProject(projectId, (x) => {
            const attempt = x.attempts.find((x) => x.id === a.id)!;
            attempt.state = "success";
            attempt.inputTokens = result.usage.input;
            attempt.outputTokens = result.usage.output;
            attempt.cost = priceCost(
              result.usage.input,
              result.usage.output,
              c.inputPrice,
              c.outputPrice,
            );
          });
          setProject(p);
          currentProject.current = p;
        }
      }
      success = true;
      message = "当前浏览器、Origin、模型的中英双向合成测试通过。";
      if (keyRef.current === key) setVerified(`${c.provider}:${c.model}`);
      notify("连接测试通过，可以开始试译");
    } catch (e) {
      message = errorMessage(e);
      setError(message);
      setVerified("");
      if (projectId && currentAttemptId) {
        try {
          const p = await mutateProject(projectId, (x) => {
            const a = x.attempts.find((a) => a.id === currentAttemptId);
            if (a?.state === "sent") {
              a.state = "unknown";
              a.error = message;
            }
          });
          setProject(p);
          currentProject.current = p;
        } catch {
          setError("连接结果或用量未可靠保存；可能已产生费用。");
        }
      }
    } finally {
      setDiagnostic((prev) => [
        {
          provider: c.provider,
          model: c.model,
          origin: location.origin,
          date: Date.now(),
          success,
          message,
          tokens: success ? tokens : null,
        },
        ...prev,
      ]);
      setTesting(false);
      void refresh();
    }
  };
  const demo = async () => {
    const p = await createDemo();
    await putProject(p);
    setProject(p);
    currentProject.current = p;
    navigate("project/" + p.id);
    void refresh();
  };
  const backup = async () => {
    if (!project) return;
    await withBusy("打包项目备份", async () => {
      const p = controller.current?.emergencyProject || project;
      const bytes = await workerCall<Uint8Array>("backup", { project: p });
      download(
        bytes,
        "application/zip",
        `${p.name.replace(/[<>:"/\\|?*]/g, "_")}.yiye.zip`,
      );
      notify(
        "项目备份已下载，不包含 API Key。备份包含原文与译文，请妥善保存。",
      );
    });
  };
  const importFile = async (file: File) => {
    await withBusy("校验项目备份", async () => {
      const p = await workerCall<Project>("import", {
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      const existing = await getProject(p.id);
      if (existing) {
        p.id = uid();
        p.name += "（导入副本）";
      }
      p.storage = "session";
      await putProject(p);
      setProject(p);
      currentProject.current = p;
      setConfig(p.config);
      setStorage("session");
      setVerified("");
      navigate("project/" + p.id);
      notify(
        existing
          ? "同名项目已作为新副本导入，未覆盖原项目"
          : "已导入，无网络请求；连接需重新测试",
      );
      void refresh();
    });
  };
  const exportNow = async () => {
    if (!project) return;
    await withBusy("生成本地译稿", async () => {
      let font: Uint8Array | undefined;
      if (exportFormat === "pdf") {
        const r = await fetch(
          new URL("fonts/NotoSansSC.ttf", document.baseURI),
        );
        if (!r.ok) throw Error("中文字体加载失败");
        font = new Uint8Array(await r.arrayBuffer());
      }
      const result = await workerCall<{
        bytes: Uint8Array;
        mime: string;
        extension: string;
      }>(
        "export",
        { project, format: exportFormat, bilingual, font },
        (n, label) => {
          setProgress(n);
          setBusy(label);
        },
      );
      download(
        result.bytes,
        result.mime,
        `${project.name.replace(/[<>:"/\\|?*]/g, "_")}-${bilingual ? "双语" : "译文"}.${result.extension}`,
      );
      setModal("");
      notify("译稿已在本地生成并下载");
    });
  };
  const saveLocal = async () => {
    if (!project) return;
    await withBusy("检查本机存储", async () => {
      await storageCheck(
        project.source.length +
          project.doc.resources.reduce((n, r) => n + r.data.length, 0),
      );
      const p = {
        ...project,
        storage: "local" as const,
        expiresAt: retention === "7" ? Date.now() + 7 * 86400000 : null,
      };
      await putProject(p);
      setProject(p);
      currentProject.current = p;
      setStorage("local");
      setPersistentConsent(true);
      notify("已保存到当前浏览器，不包含 Key；建议下载项目备份");
      void refresh();
    });
  };
  const deleteNow = async (id: string) => {
    controller.current?.cancel();
    await deleteProject(id);
    if (project?.id === id) {
      setProject(null);
      currentProject.current = null;
    }
    setModal("");
    navigate("projects");
    await refresh();
    notify("已清除本机项目；下载副本和供应商数据不受影响。");
  };
  const navItems = [
    { id: "home", title: "工作台", icon: BookOpen },
    { id: "projects", title: "本地项目", icon: FolderOpen },
    { id: "diagnostics", title: "模型连接", icon: Link },
  ];
  return (
    <div className="app">
      <input
        hidden
        ref={fileRef}
        type="file"
        accept=".pdf,.epub"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void create(f);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={backupRef}
        type="file"
        accept=".zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#/home">
          <span className="brand-icon">
            <BookOpen size={23} />
          </span>
          <span>
            译页<small>YIYE TRANSLATE</small>
          </span>
        </a>
        <Button
          className="new-project-button"
          disabled={active}
          onClick={() => {
            setProject(null);
            currentProject.current = null;
            navigate("new");
          }}
        >
          <Plus size={17} />
          新建翻译项目
        </Button>
        <div className="nav-caption">你的阅读空间</div>
        <nav>
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={page === item.id ? "nav-item active" : "nav-item"}
            >
              <item.icon size={18} />
              {item.title}
              {item.id === "projects" && (
                <span className="nav-count">{projects.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-separator" />
        <div className="nav-caption recent-label">
          最近项目 <span>{projects.length > 0 ? "本机" : ""}</span>
        </div>
        <div className="recent-projects">
          {projects.slice(0, 4).map((p) => (
            <a
              className={`recent-item ${project?.id === p.id && page === "project" ? "recent-active" : ""}`}
              href={`#/project/${p.id}`}
              key={p.id}
            >
              <span className={`file-symbol file-${p.doc.format}`}>
                {p.doc.format === "pdf" ? (
                  <FileText size={15} />
                ) : (
                  <BookOpen size={15} />
                )}
              </span>
              <span>
                {p.name}
                <small>
                  {p.demo ? "内置演示" : labels[p.state]} ·{" "}
                  {formatDate(p.savedAt)}
                </small>
              </span>
            </a>
          ))}
          {projects.length === 0 && (
            <p className="sidebar-empty">
              开始一份文档，
              <br />
              让好奇心走得更远。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={20} />
            <div>
              <strong>你的文档，留在本机</strong>
              <p>文本仅发送至所选模型供应商</p>
            </div>
          </div>
          <a href="#/help" className="nav-item">
            <Info size={17} />
            帮助与隐私
          </a>
          <a
            href="#/settings"
            className={page === "settings" ? "nav-item active" : "nav-item"}
          >
            <Settings size={17} />
            偏好设置<span className="version">v0.1</span>
          </a>
          <div className="profile">
            <span className="avatar">
              <Leaf size={18} />
            </span>
            <div>
              本地阅读空间<small>无需注册 · 自带 API Key</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="展开导航"
            >
              <PanelLeft size={18} />
            </Button>
            <span>阅读空间</span>
            <ChevronRight size={14} />
            <strong>
              {page === "home"
                ? "工作台"
                : page === "projects"
                  ? "本地项目"
                  : page === "new"
                    ? "新建项目"
                    : page === "project"
                      ? "双语工作台"
                      : page === "diagnostics"
                        ? "模型连接"
                        : page === "settings"
                          ? "偏好设置"
                          : "帮助与隐私"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <span className="status-dot" />
              浏览器本地运行
            </span>
            <Button variant="ghost" size="sm" onClick={() => navigate("help")}>
              使用指南
              <ArrowUpRight size={14} />
            </Button>
          </div>
        </header>
        <main
          className={`main-content ${page === "project" ? "reader-main" : ""}`}
        >
          {page === "home" && (
            <>
              <div className="page-heading">
                <div className="eyebrow">
                  <span />
                  MAKE ROOM FOR NEW IDEAS
                </div>
                <h1>
                  让语言不再成为<span>阅读的边界。</span>
                </h1>
                <p>一份文档，两种语言。把世界的知识，读成自己的理解。</p>
              </div>
              <div className="home-grid">
                <section
                  className="upload-card"
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f) void create(f);
                  }}
                >
                  <div className="card-heading">
                    <div>
                      <h2>从一份文档开始</h2>
                      <p>选择本地文件，开启你的下一次阅读</p>
                    </div>
                    <span className="step-badge">01</span>
                  </div>
                  <div className="drop-zone">
                    <div className="document-art">
                      <div className="art-back">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="art-front">
                        <span className="art-label">文 A</span>
                        <div className="art-line" />
                        <div className="art-line short" />
                        <div className="art-line" />
                        <div className="art-seal">
                          <Languages size={20} />
                        </div>
                      </div>
                      <span className="art-spark">✧</span>
                    </div>
                    <h3>将 PDF 或 EPUB 拖到这里</h3>
                    <p>或者，从设备中选择一份文档</p>
                    <Button onClick={() => fileRef.current?.click()}>
                      <Plus size={16} />
                      选择本地文件
                    </Button>
                    <div className="file-limits">
                      <span>PDF</span>
                      <span>EPUB</span>
                      <i />
                      单文件 ≤ 10 MiB · PDF ≤ 100 页
                    </div>
                  </div>
                  <div className="upload-foot">
                    <ShieldCheck size={15} />
                    <span>文件在设备上解析，平台不接收原文件</span>
                  </div>
                </section>
                <aside className="intro-card">
                  <div className="intro-top">
                    <span className="tiny-label">READ WITHOUT BORDERS</span>
                    <span className="intro-star">✳</span>
                  </div>
                  <h2>
                    保留原意，
                    <br />
                    也保留你的思考。
                  </h2>
                  <p>
                    从论文到电子书，逐段理解、对照校订，
                    <br className="desktop-break" />
                    把译稿掌握在自己手中。
                  </p>
                  <div className="mini-book">
                    <div className="book-left">
                      <span>01 / ORIGINAL</span>
                      <div />
                      <div />
                      <div />
                      <div className="highlight-line" />
                      <div />
                    </div>
                    <div className="book-right">
                      <span>02 / TRANSLATION</span>
                      <div />
                      <div />
                      <div className="highlight-line" />
                      <div />
                      <div />
                    </div>
                    <span className="book-fold" />
                  </div>
                  <button className="text-link" onClick={() => void demo()}>
                    看看双语阅读是什么样 <ArrowUpRight size={16} />
                  </button>
                  <span className="demo-caption">
                    内置演示 · 无需 Key · 不产生费用
                  </span>
                </aside>
              </div>
              <section className="benefits">
                {[
                  {
                    icon: HardDrive,
                    title: "本地处理，安心保存",
                    text: "文档在本机解析，项目可备份迁移。",
                  },
                  {
                    icon: KeyRound,
                    title: "你的模型，你来选择",
                    text: "支持四家官方 API 适配，自带 Key。",
                  },
                  {
                    icon: Languages,
                    title: "双语对照，逐段校订",
                    text: "原文与译文并排，思考不必来回切换。",
                  },
                ].map((i) => (
                  <div className="benefit" key={i.title}>
                    <span>
                      <i.icon size={19} />
                    </span>
                    <div>
                      <h3>{i.title}</h3>
                      <p>{i.text}</p>
                    </div>
                  </div>
                ))}
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <h2>最近的阅读</h2>
                    <span>每一段理解，都值得留下。</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("projects")}
                  >
                    全部项目
                    <ArrowRight size={15} />
                  </Button>
                </div>
                {projects.length > 0 ? (
                  <ProjectTable
                    projects={projects.slice(0, 3)}
                    onOpen={(id) => navigate("project/" + id)}
                  />
                ) : (
                  <div className="empty-recents">
                    <BookOpen size={25} />
                    <div>
                      <strong>你的第一份译稿，从这里开始</strong>
                      <p>选择文档，或打开内置演示探索双语校订。</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void demo()}
                    >
                      体验演示
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                )}
              </section>
              <div className="home-bottom">
                <span>BUILT FOR CURIOUS MINDS.</span>
                <p>保持页面运行 · 翻译文本发送至所选供应商 · 请及时保存备份</p>
              </div>
            </>
          )}
          {page === "projects" && (
            <>
              <div className="standard-heading">
                <div>
                  <div className="eyebrow">YOUR LOCAL LIBRARY</div>
                  <h1>本地项目</h1>
                  <p>
                    保存在当前浏览器的文档与译稿。换设备或域名，请使用项目备份迁移。
                  </p>
                </div>
                <div className="inline-actions">
                  <Button
                    variant="outline"
                    onClick={() => backupRef.current?.click()}
                  >
                    <Upload size={16} />
                    导入项目包
                  </Button>
                  <Button onClick={() => navigate("new")}>
                    <Plus size={16} />
                    新建项目
                  </Button>
                </div>
              </div>
              <div className="list-toolbar">
                <div className="search-input">
                  <Search size={16} />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="搜索你的文档"
                  />
                </div>
                <span className="muted">
                  {projects.length} 个项目 · 无云端同步
                </span>
              </div>
              <ProjectTable
                projects={projects.filter((p) =>
                  p.name.toLowerCase().includes(filter.toLowerCase()),
                )}
                onOpen={(id) => navigate("project/" + id)}
                onDelete={(p) => {
                  setProject(p);
                  setModal("delete");
                }}
              />
              {projects.some(
                (p) => p.expiresAt && p.expiresAt < Date.now(),
              ) && (
                <div className="notice warning">
                  <Clock size={18} />
                  有项目已超过七天保留期。请先备份，再按需删除；关闭页面后不会自动清理。
                </div>
              )}
            </>
          )}
          {page === "new" && (
            <>
              <div className="standard-heading">
                <div>
                  <div className="eyebrow">A NEW READING JOURNEY</div>
                  <h1>新建翻译项目</h1>
                  <p>先检查原文，再用少量试译找到适合的表达。</p>
                </div>
                {project && (
                  <Button
                    variant="outline"
                    onClick={() => navigate("project/" + project.id)}
                  >
                    查看原文
                    <ArrowRight size={15} />
                  </Button>
                )}
              </div>
              <div className="setup-grid">
                <div className="setup-main">
                  <section className="panel">
                    <div className="panel-heading">
                      <span className="number">1</span>
                      <h2>选择文档与检查解析</h2>
                    </div>
                    {project ? (
                      <>
                        <div className="selected-file">
                          <span
                            className={`large-file file-${project.doc.format}`}
                          >
                            <FileText size={25} />
                          </span>
                          <div>
                            <h3>{project.name}</h3>
                            <p>
                              {project.doc.format.toUpperCase()} ·{" "}
                              {project.doc.sections.length}{" "}
                              {project.doc.format === "pdf" ? "页" : "章"} ·{" "}
                              {project.doc.blocks.length} 块 · 约{" "}
                              {project.doc.estimatedTokens.toLocaleString()}{" "}
                              tokens
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => fileRef.current?.click()}
                          >
                            更换
                          </Button>
                        </div>
                        <div className="inline-actions">
                          <Badge
                            tone={
                              project.doc.warnings.length ? "amber" : "green"
                            }
                          >
                            {project.doc.warnings.length
                              ? `${project.doc.warnings.length} 项处理说明`
                              : "解析完成"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setModal("report")}
                          >
                            查看解析报告
                            <ArrowUpRight size={13} />
                          </Button>
                        </div>
                        <div className="source-preview">
                          {project.doc.blocks
                            .filter(translatable)
                            .slice(0, 2)
                            .map((b) => (
                              <p key={b.id}>{b.text}</p>
                            ))}
                        </div>
                      </>
                    ) : (
                      <button
                        className="compact-drop"
                        onClick={() => fileRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const f = e.dataTransfer.files[0];
                          if (f) void create(f);
                        }}
                      >
                        <Upload size={28} />
                        <strong>选择或拖入 PDF / EPUB</strong>
                        <span>单栏文本 PDF、可重排 EPUB · 最大 10 MiB</span>
                      </button>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <span className="number">2</span>
                      <h2>设定翻译方式</h2>
                    </div>
                    <ConfigFields
                      config={config}
                      setConfig={setConfig}
                      disabled={active}
                    />
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <span className="number">3</span>
                      <h2>连接自己的模型</h2>
                      <Badge tone={verified ? "green" : "gray"}>
                        {verified ? "已验证" : "待测试"}
                      </Badge>
                    </div>
                    <KeyForm
                      apiKey={apiKey}
                      setApiKey={setApiKey}
                      showKey={showKey}
                      setShowKey={setShowKey}
                      testing={testing}
                      verified={verified}
                      onTest={() => void test()}
                      provider={config.provider}
                    />
                  </section>
                </div>
                <aside className="setup-aside">
                  <section className="panel">
                    <h2>准备开始</h2>
                    <div className="summary-row">
                      <span>方向</span>
                      <strong>
                        {config.direction === "en-zh"
                          ? "英文 → 中文"
                          : "中文 → 英文"}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>模型</span>
                      <strong>{providers[config.provider].name}</strong>
                    </div>
                    <div className="summary-row">
                      <span>预估费用</span>
                      <strong>待用量确认</strong>
                    </div>
                    <p className="fine-print">
                      费用由你的供应商账户承担。试译、重试和连接测试也可能收费。
                    </p>
                    <div className="save-options">
                      <h3>项目保存方式</h3>
                      <label>
                        <input
                          type="radio"
                          checked={storage === "session"}
                          onChange={() => setStorage("session")}
                        />
                        仅本次会话 <small>关页后未导出的结果会丢失</small>
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={storage === "local"}
                          onChange={() => setStorage("local")}
                        />
                        保存到当前浏览器{" "}
                        <small>可恢复已保存的段落，不保存 Key</small>
                      </label>
                      {storage === "local" && (
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={persistentConsent}
                            onChange={(e) =>
                              setPersistentConsent(e.target.checked)
                            }
                          />
                          同意本机保存原文、译稿与用量
                        </label>
                      )}
                    </div>
                    <div className="notice">
                      <Info size={16} />
                      <span>
                        待译文本及术语 / 邻段会直接发送至所选官方
                        API。请确认你有处理该文档的权限。
                      </span>
                    </div>
                    <Button
                      disabled={
                        !project ||
                        !verified ||
                        testing ||
                        active ||
                        (storage === "local" && !persistentConsent)
                      }
                      className="full-width"
                      onClick={() => void run("trial")}
                    >
                      <Play size={16} />
                      先试译 3 段
                    </Button>
                    <Button
                      disabled={
                        !project ||
                        !verified ||
                        testing ||
                        active ||
                        (storage === "local" && !persistentConsent)
                      }
                      variant="outline"
                      className="full-width"
                      onClick={() => void run("all")}
                    >
                      开始全文翻译
                      <ArrowRight size={16} />
                    </Button>
                    <p className="fine-print centered">
                      保持页面前台运行 · 建议及时下载备份
                    </p>
                  </section>
                  <section className="quiet-card">
                    <ShieldCheck size={21} />
                    <h3>不必把整本书交给平台</h3>
                    <p>
                      原文件在浏览器解析。翻译请求只包含当前文本块、术语和有限邻段上下文。
                    </p>
                  </section>
                </aside>
              </div>
            </>
          )}
          {page === "project" && project && (
            <>
              <div className="reader-heading">
                <div>
                  <a className="back-link" href="#/projects">
                    <ArrowLeft size={13} />
                    本地项目
                  </a>
                  <h1>{project.name}</h1>
                  <div className="reader-meta">
                    <Badge
                      tone={
                        project.demo
                          ? "gray"
                          : project.state === "completed"
                            ? "green"
                            : "amber"
                      }
                    >
                      {project.demo ? "演示译稿" : labels[project.state]}
                    </Badge>
                    <span>{project.doc.format.toUpperCase()}</span>
                    <span>
                      {config.direction === "en-zh"
                        ? "英文 → 中文"
                        : "中文 → 英文"}
                    </span>
                    <span>
                      {project.storage === "local"
                        ? "当前浏览器保存"
                        : "仅本次会话"}
                    </span>
                  </div>
                </div>
                <div className="inline-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void backup()}
                  >
                    <FileArchive size={15} />
                    项目备份
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setExportFormat(project.doc.format);
                      setModal("export");
                    }}
                  >
                    <Download size={15} />
                    导出译稿
                  </Button>
                </div>
              </div>
              <div className="task-strip">
                <div className="task-progress">
                  <span>
                    {project.demo
                      ? "演示已就绪"
                      : `${completed} / ${allBlocks.length} 段已保存`}
                  </span>
                  <div className="progress-track">
                    <i style={{ width: `${percent}%` }} />
                  </div>
                  <strong>{percent}%</strong>
                </div>
                <span className="task-cost">
                  {project.demo
                    ? "未调用 API"
                    : cost?.known
                      ? `${cost.known.toFixed(4)} ${project.config.currency} 已知费用`
                      : "费用待确认"}
                  {!project.demo &&
                    !!cost?.unknown &&
                    ` · ${cost.unknown} 次费用未知`}
                </span>
                <div className="inline-actions">
                  {active ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          controller.current?.pause();
                          notify("已请求暂停，将等待在途结果处理后停止。");
                        }}
                      >
                        <Pause size={14} />
                        暂停
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          controller.current?.cancel();
                          notify("已停止本地等待；已发送请求可能计费。");
                        }}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    !project.demo && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          verified ? void run("all") : setModal("config")
                        }
                      >
                        <Play size={14} />
                        {project.state === "completed"
                          ? "检查设置"
                          : "继续翻译"}
                      </Button>
                    )
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setModal("config")}
                    aria-label="翻译设置"
                  >
                    <SlidersHorizontal size={17} />
                  </Button>
                </div>
              </div>
              <p
                className={`task-message ${controller.current?.emergencyProject ? "error-text" : ""}`}
              >
                <Info size={13} />
                {project.message}
                {controller.current?.emergencyProject && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void backup()}
                  >
                    下载应急备份
                  </Button>
                )}
              </p>
              <div className="reader-layout">
                <aside className="toc">
                  <div className="toc-heading">
                    文档目录<span>{project.doc.sections.length} 节</span>
                  </div>
                  <button
                    className={
                      section === "all" ? "toc-item selected" : "toc-item"
                    }
                    onClick={() => {
                      setSection("all");
                      setReaderLimit(30);
                    }}
                  >
                    <BookOpen size={15} />
                    全部内容
                  </button>
                  {project.doc.sections.map((s) => (
                    <button
                      key={s.id}
                      className={
                        section === s.id ? "toc-item selected" : "toc-item"
                      }
                      onClick={() => {
                        setSection(s.id);
                        setReaderLimit(30);
                      }}
                    >
                      <span className="toc-order">
                        {String(s.order + 1).padStart(2, "0")}
                      </span>
                      {s.title}
                    </button>
                  ))}
                  <div className="toc-bottom">
                    <button onClick={() => setModal("report")}>
                      <FileText size={15} />
                      解析与遗漏报告
                    </button>
                    <button onClick={() => setModal("usage")}>
                      <Clock size={15} />
                      用量与调用记录
                    </button>
                    {project.storage !== "local" && (
                      <button onClick={() => setModal("save")}>
                        <HardDrive size={15} />
                        保存到当前浏览器
                      </button>
                    )}
                    <button onClick={() => setModal("delete")}>
                      <Trash2 size={15} />
                      删除项目
                    </button>
                  </div>
                </aside>
                <section className="reader">
                  <div className="reader-toolbar">
                    <div className="inline-actions">
                      <span className="reading-mode">
                        <Languages size={16} />
                        双语对照
                      </span>
                      <Badge tone="gray">
                        {project.config.style === "faithful"
                          ? "忠实"
                          : project.config.style === "natural"
                            ? "自然"
                            : "技术"}
                      </Badge>
                    </div>
                    <div className="search-input compact">
                      <Search size={15} />
                      <Input
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setReaderLimit(30);
                        }}
                        placeholder="搜索原文或译文"
                      />
                    </div>
                  </div>
                  <div className="column-labels">
                    <span>
                      <i />
                      原文{" "}
                      <small>
                        {config.direction === "en-zh" ? "ENGLISH" : "CHINESE"}
                      </small>
                    </span>
                    <span>
                      <i />
                      译文{" "}
                      <small>
                        {config.direction === "en-zh" ? "简体中文" : "ENGLISH"}
                      </small>
                      <span className="edit-hint">点击译文即可校订</span>
                    </span>
                  </div>
                  <ReaderBlocks
                    project={project}
                    section={section}
                    search={search}
                    limit={readerLimit}
                    onMore={() => setReaderLimit((x) => x + 30)}
                    onSave={async (id, text) => {
                      try {
                        const p = await saveManual(project.id, id, text);
                        setProject(p);
                        currentProject.current = p;
                        notify("人工校订已保存");
                        void refresh();
                      } catch (e) {
                        setError(errorMessage(e));
                        throw e;
                      }
                    }}
                    onRetry={(id) =>
                      verified ? void run("retry", id) : setModal("config")
                    }
                    onAccept={async (id) => {
                      const p = await acceptCandidate(project.id, id);
                      setProject(p);
                      currentProject.current = p;
                      notify("已采用候选译文");
                    }}
                    busy={active}
                  />
                </section>
              </div>
            </>
          )}
          {page === "diagnostics" && (
            <>
              <div className="standard-heading">
                <div>
                  <div className="eyebrow">YOUR MODEL, YOUR CHOICE</div>
                  <h1>模型连接</h1>
                  <p>
                    从当前浏览器直接调用官方 API。每次刷新后需重新输入 Key
                    和测试连接。
                  </p>
                </div>
                <Badge tone="gray">无代理 · 无公共密钥</Badge>
              </div>
              <div className="diagnostic-grid">
                {(Object.keys(providers) as Provider[]).map((v) => (
                  <section className="provider-card panel" key={v}>
                    <span className={`provider-logo mark-${v}`}>
                      {v === "deepseek"
                        ? "D"
                        : v === "glm"
                          ? "智"
                          : v === "gemini"
                            ? "✦"
                            : "◎"}
                    </span>
                    <h2>{providers[v].name}</h2>
                    <p>{providers[v].subtitle}</p>
                    <Badge
                      tone={verified.startsWith(v + ":") ? "green" : "gray"}
                    >
                      {verified.startsWith(v + ":")
                        ? "本次会话已验证"
                        : "浏览器直连待验证"}
                    </Badge>
                    <div className="provider-endpoint">
                      {new URL(providers[v].endpoint).hostname}
                    </div>
                    <Button
                      variant="outline"
                      className="full-width"
                      size="sm"
                      onClick={() => {
                        setConfig((c) => ({
                          ...c,
                          provider: v,
                          model: providers[v].models[0],
                        }));
                        setModal("connection");
                      }}
                    >
                      配置与测试
                      <ArrowRight size={14} />
                    </Button>
                    <a
                      href={providers[v].help}
                      rel="noreferrer"
                      target="_blank"
                    >
                      官方文档
                      <ArrowUpRight size={13} />
                    </a>
                  </section>
                ))}
              </div>
              <section className="panel">
                <h2>本次会话诊断记录</h2>
                <p className="fine-print">
                  仅发送合成短文本，可能产生少量费用。不记录
                  Key。连接通过只证明当前 Origin、型号与请求形式可用。
                </p>
                {diagnostic.length === 0 ? (
                  <div className="empty-record">
                    <Globe size={25} />
                    <p>尚未进行连接测试。选择供应商后开始。</p>
                  </div>
                ) : (
                  diagnostic.map((d, i) => (
                    <div className="diagnostic-row" key={i}>
                      {d.success ? (
                        <CheckCircle2 size={19} className="green-text" />
                      ) : (
                        <AlertTriangle size={19} className="amber-text" />
                      )}
                      <div>
                        <strong>
                          {providers[d.provider].name} · {d.model}
                        </strong>
                        <p>{d.message}</p>
                        <small>
                          {d.origin} ·{" "}
                          {new Date(d.date).toLocaleString("zh-CN")} ·{" "}
                          {d.tokens === null
                            ? "费用 / 用量未知"
                            : `${d.tokens} tokens，费用依供应商账单`}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </section>
              <div className="notice">
                <Info size={18} />
                CORS / 网络失败无法证明 Key
                无效。本网站不会使用代理、关闭浏览器安全设置或自动切换模型。
              </div>
            </>
          )}
          {page === "settings" && (
            <>
              <div className="standard-heading">
                <div>
                  <div className="eyebrow">MAKE IT YOURS</div>
                  <h1>偏好设置</h1>
                  <p>
                    翻译默认值只影响新项目，已存在的任务保留自己的配置版本。
                  </p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="panel">
                  <h2>新项目默认翻译方式</h2>
                  <ConfigFields config={config} setConfig={setConfig} />
                  <p className="fine-print">
                    本次页面会话有效。Key 不属于设置，不会保存。
                  </p>
                </section>
                <div>
                  <section className="panel">
                    <h2>本地数据管理</h2>
                    <Select
                      label="项目保留策略"
                      value={retention}
                      onChange={setRetention}
                    >
                      <option value="7">七天后打开时提醒清理</option>
                      <option value="manual">手动管理</option>
                    </Select>
                    <p className="fine-print">
                      浏览器可能因空间压力清除数据。关闭页面后不会定时删除，下载副本由操作系统管理。
                    </p>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const granted = await navigator.storage?.persist?.();
                        notify(
                          granted
                            ? "浏览器已授予持久存储；仍建议备份。"
                            : "浏览器未授予持久存储，请及时备份。",
                        );
                      }}
                    >
                      <HardDrive size={15} />
                      申请持久存储
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const e = await navigator.storage?.estimate?.();
                        notify(
                          e
                            ? `当前 Origin 使用约 ${((e.usage || 0) / 1048576).toFixed(1)} MiB / ${((e.quota || 0) / 1048576).toFixed(0)} MiB；含同源其他数据`
                            : "浏览器未提供存储估计",
                        );
                      }}
                    >
                      查看存储估计
                    </Button>
                  </section>
                  <section className="panel danger-panel">
                    <h2>清除本机数据</h2>
                    <p>
                      删除译页项目、正文、译稿与用量。下载副本和供应商保存的数据不会删除。
                    </p>
                    <Button
                      variant="destructive"
                      onClick={() => setModal("clear")}
                    >
                      <Trash2 size={15} />
                      清除全部译页项目
                    </Button>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === "help" && (
            <>
              <div className="standard-heading">
                <div>
                  <div className="eyebrow">READ WITH CONFIDENCE</div>
                  <h1>理解工具，也理解边界。</h1>
                  <p>让每一份文档的去向和每一步操作都清楚可见。</p>
                </div>
              </div>
              <div className="help-grid">
                <section className="panel">
                  <h2>三步开始阅读</h2>
                  {[
                    {
                      n: "01",
                      title: "选择文档，检查解析",
                      text: "支持单栏文本 PDF 与可重排 EPUB。先检查原文、阅读顺序与遗漏报告。扫描文档、DRM 和固定版式不受支持。",
                    },
                    {
                      n: "02",
                      title: "输入自己的 Key，先试译",
                      text: "选择官方供应商，测试中英双向合成文本。Key 只在当前页面内存。试译后确认表达与用量，再开始整篇。",
                    },
                    {
                      n: "03",
                      title: "对照校订，下载备份",
                      text: "点击译文进行修改，单段重译生成候选，不覆盖人工稿。导出成品，并保存项目包，便于迁移与恢复。",
                    },
                  ].map((s) => (
                    <div className="help-step" key={s.n}>
                      <span>{s.n}</span>
                      <div>
                        <h3>{s.title}</h3>
                        <p>{s.text}</p>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="panel privacy-panel">
                  <ShieldCheck size={26} />
                  <h2>你的数据经过哪里？</h2>
                  <div className="data-flow">
                    <span>本地文件</span>
                    <ArrowRight size={15} />
                    <span>浏览器解析</span>
                    <ArrowRight size={15} />
                    <span>所选官方 API</span>
                  </div>
                  <p>
                    平台分发程序资源。文档与 Key
                    不上传平台业务服务；待译文本、术语与有限邻段直接发送给供应商。静态托管仍可能记录资源访问的
                    IP、时间和 URL。
                  </p>
                  <p>
                    默认无遥测、第三方分析和远程脚本。本机保存与下载备份都含私密正文；备份默认不加密。供应商数据政策分别适用，本地删除不能替代对方保留规则。
                  </p>
                  <p>
                    BYOK
                    仍在浏览器中使用凭据，页面代码和扩展可能读取输入。请使用低额度专用
                    Key，不在不可信预览或共享设备中输入生产 Key。
                  </p>
                </section>
                <section className="panel">
                  <h2>支持范围</h2>
                  <div className="support-row">
                    <strong>PDF</strong>
                    <span>
                      ≤100 页、10 MiB，单栏可选文本。导出重排
                      PDF，文字可搜索复制，原分页不保留。
                    </span>
                  </div>
                  <div className="support-row">
                    <strong>EPUB</strong>
                    <span>
                      可重排 EPUB 2/3，按 spine 阅读顺序解析，导出 EPUB
                      3。保留安全基础结构、图片与内部锚点。
                    </span>
                  </div>
                  <div className="support-row">
                    <strong>移动端</strong>
                    <span>
                      ≤5 MiB、PDF ≤30
                      页，适合小文件阅读。长文建议桌面并保持页面前台运行。
                    </span>
                  </div>
                  <div className="support-row">
                    <strong>运行</strong>
                    <span>
                      一次一个任务，模型并发为
                      1。关页、休眠和断网可能中断。未知调用不自动重试。
                    </span>
                  </div>
                  <div className="support-row">
                    <strong>版本</strong>
                    <span>
                      v0.1 · 核查日期 2026-10-13 ·
                      未完成四浏览器矩阵与真实账号质量评审。
                    </span>
                  </div>
                </section>
                <section className="panel">
                  <h2>供应商与费用</h2>
                  <p>
                    所有模型费用由你的供应商账户承担。客户端预算是软限制，无法控制其他设备与应用的调用；中断已发送请求也不保证免费。
                  </p>
                  {(Object.keys(providers) as Provider[]).map((v) => (
                    <div className="support-row" key={v}>
                      <strong>{providers[v].name}</strong>
                      <span>
                        <a
                          href={providers[v].help}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方 API 文档 <ExternalLink size={12} />
                        </a>{" "}
                        ·{" "}
                        <a
                          href={providers[v].policy}
                          target="_blank"
                          rel="noreferrer"
                        >
                          数据政策 / 条款 <ExternalLink size={12} />
                        </a>
                      </span>
                    </div>
                  ))}
                  <p className="fine-print">
                    OpenAI 和 Gemini 官方建议保护 Key，BYOK
                    不构成其对浏览器生产安全架构的背书。DeepSeek / GLM
                    的数据保留与地区条款需由用户核查。
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <BookOpen size={13} />
            译页 · 为认真阅读而做
          </span>
          <span>本机处理 · 自主选择 · 自由导出</span>
        </footer>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setError("")}
            aria-label="关闭错误"
          >
            <X size={16} />
          </Button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status">
          <div className="busy-card">
            <Loader2 className="spin" size={28} />
            <h3>{busy}</h3>
            <p>在当前设备处理，没有上传文件</p>
            <div className="progress-track">
              <i style={{ width: `${progress || 8}%` }} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => workAbort.current?.abort()}
            >
              取消本地操作
            </Button>
          </div>
        </div>
      )}
      {modal === "report" && project && (
        <Modal title="解析与遗漏报告" onClose={() => setModal("")} wide>
          <div className="report-summary">
            <Badge>{project.doc.format.toUpperCase()}</Badge>
            <span>
              {project.doc.sections.length} 节 · {project.doc.blocks.length} 块
              · {project.doc.estimatedTokens.toLocaleString()} tokens（估算）
            </span>
          </div>
          <p>
            源文件 SHA-256：
            <code className="hash-text">{project.doc.fileHash}</code>
          </p>
          {project.doc.warnings.length ? (
            project.doc.warnings.map((w, i) => (
              <div className="notice warning" key={i}>
                <AlertTriangle size={16} />
                {w}
              </div>
            ))
          ) : (
            <div className="notice">
              <CheckCircle2 size={17} />
              未检测到扫描或复杂阅读顺序；请仍通过原文预览确认内容。
            </div>
          )}
          <p className="fine-print">
            支持范围内的识别不等于出版级保真。导出报告会列出所有未翻译段落与降级内容。
          </p>
          {project.doc.warnings.some((w) => w.includes("无可提取文本")) && (
            <label className="consent">
              <input
                type="checkbox"
                checked={partialConsent}
                onChange={(e) => setPartialConsent(e.target.checked)}
              />
              只处理可识别的文本页，接受明确标注的遗漏
            </label>
          )}
          <Button onClick={() => setModal("")}>已检查</Button>
        </Modal>
      )}
      {(modal === "config" || modal === "connection") && (
        <Modal
          title={modal === "config" ? "翻译设置与连接" : "测试模型连接"}
          wide
          onClose={() => setModal("")}
        >
          <ConfigFields
            config={config}
            setConfig={setConfig}
            disabled={active || testing}
          />
          <KeyForm
            apiKey={apiKey}
            setApiKey={setApiKey}
            showKey={showKey}
            setShowKey={setShowKey}
            testing={testing}
            verified={verified}
            onTest={() => void test()}
            provider={config.provider}
          />
          {modal === "config" && (
            <div className="modal-actions">
              <Button variant="outline" onClick={() => setModal("")}>
                返回校订
              </Button>
              <Button
                disabled={!verified || testing || active}
                onClick={() => {
                  setModal("");
                  void run("all");
                }}
              >
                保存配置并继续
                <Play size={14} />
              </Button>
            </div>
          )}
        </Modal>
      )}
      {modal === "export" && project && (
        <Modal title="导出你的译稿" onClose={() => setModal("")}>
          <p className="muted">
            完全在浏览器生成。未完成段落会标记为【未翻译】。
          </p>
          <Select
            label="文件格式"
            value={exportFormat}
            onChange={setExportFormat}
          >
            <option value={project.doc.format}>
              {project.doc.format === "pdf"
                ? "PDF · 可搜索的重排文档"
                : "EPUB 3 · 可重排电子书"}
            </option>
            <option value="html">HTML + 图片与报告（ZIP）</option>
            <option value="md">Markdown + 图片与报告（ZIP）</option>
          </Select>
          <Select
            label="内容模式"
            value={bilingual ? "bilingual" : "translation"}
            onChange={(v) => setBilingual(v === "bilingual")}
          >
            <option value="bilingual">双语对照 · 原文 + 译文</option>
            <option value="translation">仅译文 · 未完成内容明确标记</option>
          </Select>
          {project.doc.warnings.length > 0 && (
            <div className="notice warning">
              <Info size={16} />
              {project.doc.warnings.length} 项解析说明将随译稿保留。
            </div>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal("")}>
              取消
            </Button>
            <Button onClick={() => void exportNow()}>
              <Download size={16} />
              生成并下载
            </Button>
          </div>
        </Modal>
      )}
      {modal === "usage" && project && (
        <Modal title="用量与调用记录" wide onClose={() => setModal("")}>
          <div className="usage-stats">
            <div>
              <small>已知费用</small>
              <strong>
                {cost?.known.toFixed(4)}{" "}
                <small>{project.config.currency}</small>
              </strong>
            </div>
            <div>
              <small>未知费用次数</small>
              <strong>{cost?.unknown}</strong>
            </div>
            <div>
              <small>请求 / 限制</small>
              <strong>
                {cost?.requests} / {project.config.maxRequests}
              </strong>
            </div>
          </div>
          <p className="fine-print">
            未知结果可能已计费。显示的 token
            包含无用量请求的保守预留。失败调用不会自动归零，最终以供应商账单为准。
          </p>
          {project.attempts.some(
            (a) => a.state === "unknown" || a.state === "sent",
          ) && (
            <div className="notice warning">
              <AlertTriangle size={18} />
              <div>
                存在结果未知的请求。允许重试会保留原费用预留，可能产生重复费用。
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const p = await mutateProject(project.id, (x) => {
                      x.attempts
                        .filter((a) => a.state === "sent")
                        .forEach((a) => (a.state = "unknown"));
                    });
                    const next = await acknowledgeUnknown(p.id);
                    setProject(next);
                    currentProject.current = next;
                    notify("已允许手动重试，原费用预留保留。");
                  }}
                >
                  我已检查账单，允许手动重试
                </Button>
              </div>
            </div>
          )}
          <div className="attempt-list">
            {project.attempts.length === 0 ? (
              <p className="muted">尚未发送模型请求。</p>
            ) : (
              project.attempts.map((a) => (
                <div key={a.id}>
                  <strong>{a.blockId}</strong>
                  <Badge tone={a.state === "success" ? "green" : "amber"}>
                    {a.state === "success"
                      ? "已返回"
                      : a.state === "sent"
                        ? "在途"
                        : a.state === "unknown"
                          ? "未知"
                          : "失败"}
                  </Badge>
                  <span>
                    {a.inputTokens ?? "?"} 输入 / {a.outputTokens ?? "?"} 输出
                  </span>
                  <span>
                    {a.cost === null
                      ? "费用未知"
                      : `${a.cost.toFixed(5)} ${a.currency}`}
                  </span>
                  {a.error && <p>{a.error}</p>}
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
      {modal === "save" && project && (
        <Modal title="保存到当前浏览器" onClose={() => setModal("")}>
          <p>
            将原文、资源、译稿、配置与用量保存到 IndexedDB，不保存
            Key。当前设备或域名更换后需通过项目包迁移。
          </p>
          <p>
            浏览器可能清除本地数据，项目备份默认不加密。默认七天后打开时提醒清理，不承诺关页后定时删除。
          </p>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal("")}>
              仅本次会话
            </Button>
            <Button
              onClick={() => {
                setModal("");
                void saveLocal();
              }}
            >
              同意并保存
            </Button>
          </div>
        </Modal>
      )}
      {modal === "delete" && project && (
        <Modal title="删除本机项目？" onClose={() => setModal("")}>
          <p>
            将删除「{project.name}
            」的原文、译稿与调用记录，停止新请求。已发请求可能计费。下载文件和供应商数据不会删除。
          </p>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal("")}>
              保留项目
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteNow(project.id)}
            >
              删除项目
            </Button>
          </div>
        </Modal>
      )}
      {modal === "clear" && (
        <Modal title="清除全部译页项目？" onClose={() => setModal("")}>
          <p>
            删除本应用的所有本机项目与会话数据，并清除当前内存
            Key。此操作无法恢复，请先下载需要的项目备份。
          </p>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal("")}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                controller.current?.cancel();
                await clearProjects();
                setApiKey("");
                setVerified("");
                setProject(null);
                currentProject.current = null;
                setDiagnostic([]);
                setModal("");
                await refresh();
                notify("译页本机项目已清除");
              }}
            >
              确认清除
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
  function setReaderLimit(action: number | ((v: number) => number)) {
    setLimit(action);
  }
}

function KeyForm({
  apiKey,
  setApiKey,
  showKey,
  setShowKey,
  testing,
  verified,
  onTest,
  provider,
}: {
  apiKey: string;
  setApiKey: (v: string) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  testing: boolean;
  verified: string;
  onTest: () => void;
  provider: Provider;
}) {
  return (
    <div className="key-form">
      <label className="field">
        <span>
          API Key <small>只在当前页面内存，刷新后重新输入</small>
        </span>
        <div className="key-input">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
            placeholder="输入你的 API Key"
            disabled={testing}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowKey(!showKey)}
            aria-label={showKey ? "隐藏 Key" : "显示 Key"}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
        </div>
      </label>
      <div className="inline-actions">
        <Button
          variant="outline"
          disabled={testing || !apiKey.trim()}
          onClick={onTest}
        >
          {testing ? (
            <Loader2 className="spin" size={15} />
          ) : (
            <Globe size={15} />
          )}{" "}
          {testing ? "测试中英双向连接…" : "测试连接"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={testing}
          onClick={() => setApiKey("")}
        >
          清除 Key
        </Button>
        {verified && (
          <Badge>
            <Check size={12} />
            本次会话通过
          </Badge>
        )}
      </div>
      <p className="fine-print">
        仅发送两条合成短文本，可能收费。
        <a href={providers[provider].help} rel="noreferrer" target="_blank">
          官方 API 帮助 <ExternalLink size={11} />
        </a>{" "}
        · 本网站不提供公共 Key。
      </p>
    </div>
  );
}
function ProjectTable({
  projects,
  onOpen,
  onDelete,
}: {
  projects: Project[];
  onOpen: (id: string) => void;
  onDelete?: (p: Project) => void;
}) {
  if (!projects.length)
    return (
      <div className="empty-projects">
        <FolderOpen size={35} />
        <h3>这里还没有文档</h3>
        <p>开始新项目，或导入已有的项目备份。</p>
      </div>
    );
  return (
    <div className="project-table">
      <div className="table-header">
        <span>文档名称</span>
        <span>翻译方向</span>
        <span>状态</span>
        <span>最近打开</span>
        <span />
      </div>
      {projects.map((p) => (
        <div className="table-row" key={p.id}>
          <button className="table-document" onClick={() => onOpen(p.id)}>
            <span className={`large-file file-${p.doc.format}`}>
              {p.doc.format === "pdf" ? (
                <FileText size={21} />
              ) : (
                <BookOpen size={21} />
              )}
            </span>
            <span>
              <strong>{p.name}</strong>
              <small>
                {p.doc.format.toUpperCase()} ·{" "}
                {p.demo
                  ? "内置演示"
                  : `${p.doc.sections.length} ${p.doc.format === "pdf" ? "页" : "章"}`}{" "}
                · {p.storage === "local" ? "本机保存" : "会话项目"}
              </small>
            </span>
          </button>
          <span className="table-direction">
            {p.config.direction === "en-zh" ? "英文 → 中文" : "中文 → 英文"}
          </span>
          <span>
            <Badge
              tone={
                p.state === "completed"
                  ? "green"
                  : p.state === "ready"
                    ? "gray"
                    : "amber"
              }
            >
              {p.demo ? "演示稿" : labels[p.state]}
            </Badge>
          </span>
          <span className="table-date">{formatDate(p.savedAt)}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={onDelete ? `删除 ${p.name}` : `打开 ${p.name}`}
            onClick={() => (onDelete ? onDelete(p) : onOpen(p.id))}
          >
            {onDelete ? <Trash2 size={15} /> : <ArrowUpRight size={16} />}
          </Button>
        </div>
      ))}
    </div>
  );
}
function ReaderBlocks({
  project,
  section,
  search,
  limit,
  onMore,
  onSave,
  onRetry,
  onAccept,
  busy,
}: {
  project: Project;
  section: string;
  search: string;
  limit: number;
  onMore: () => void;
  onSave: (id: string, text: string) => Promise<void>;
  onRetry: (id: string) => void;
  onAccept: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const blocks = project.doc.blocks.filter(
    (b) =>
      (section === "all" || b.sectionId === section) &&
      (!search ||
        `${b.text} ${selectedRevision(project, b.id)?.text || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <div className="reader-blocks">
      {blocks.slice(0, limit).map((b) => (
        <BlockRow
          key={b.id}
          block={b}
          project={project}
          onSave={(text) => onSave(b.id, text)}
          onRetry={() => onRetry(b.id)}
          onAccept={onAccept}
          busy={busy}
        />
      ))}
      {blocks.length === 0 && (
        <div className="empty-record">
          <Search size={22} />
          <p>没有符合条件的段落</p>
        </div>
      )}
      {blocks.length > limit && (
        <Button variant="outline" onClick={onMore} className="load-more">
          继续显示 30 块 · 共 {blocks.length} 块
        </Button>
      )}
      <div className="reader-end">
        <span />
        <Leaf size={16} />
        <span />
      </div>
    </div>
  );
}
function BlockRow({
  block: b,
  project: p,
  onSave,
  onRetry,
  onAccept,
  busy,
}: {
  block: Block;
  project: Project;
  onSave: (text: string) => Promise<void>;
  onRetry: () => void;
  onAccept: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const revision = selectedRevision(p, b.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(revision?.text || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [url, setUrl] = useState("");
  const candidate = p.revisions
    .filter((r) => r.blockId === b.id && r.origin === "candidate")
    .at(-1);
  useEffect(() => {
    if (!editing) setText(revision?.text || "");
  }, [revision?.id, editing]);
  useEffect(() => {
    if (b.resource) {
      const r = p.doc.resources.find((r) => r.path === b.resource);
      if (r) {
        const u = URL.createObjectURL(
          new Blob([r.data as BlobPart], { type: r.mime }),
        );
        setUrl(u);
        return () => URL.revokeObjectURL(u);
      }
    }
  }, [b.resource, p.id]);
  const Tag = b.type === "heading" ? "h3" : b.type === "code" ? "pre" : "p";
  if (b.type === "image")
    return (
      <figure className="reader-image">
        {url && <img src={url} alt={b.text} loading="lazy" />}
        <figcaption>{b.text} · 原始图片，图内文字未翻译</figcaption>
      </figure>
    );
  return (
    <article
      className={`block-row ${b.type === "heading" ? "heading-row" : ""}`}
    >
      <div
        className="source-column"
        lang={p.config.direction === "en-zh" ? "en" : "zh-CN"}
      >
        <small className="block-locator">{b.locator}</small>
        <Tag>{b.text}</Tag>
      </div>
      <div
        className="target-column"
        lang={p.config.direction === "en-zh" ? "zh-CN" : "en"}
      >
        <div className="block-status">
          <span>
            {b.type === "code"
              ? "代码原样保留"
              : revision?.origin === "manual"
                ? "人工校订"
                : p.demo
                  ? "演示译文"
                  : revision
                    ? "已保存"
                    : "等待翻译"}
          </span>
          {translatable(b) && (
            <div>
              <button
                title="重译本段（可能收费）"
                aria-label={`重译 ${b.locator}`}
                onClick={onRetry}
                disabled={busy || p.demo}
              >
                <RotateCcw size={13} />
              </button>
              {revision && (
                <button onClick={() => setEditing(true)}>编辑</button>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <>
            <Textarea
              autoFocus
              rows={Math.max(3, Math.min(12, text.length / 35))}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="inline-actions">
              <Button
                size="sm"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(text);
                    setEditing(false);
                  } catch (e) {
                    setSaveError(errorMessage(e));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "保存中" : "保存校订"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setText(revision?.text || "");
                }}
              >
                取消
              </Button>
            </div>
            {saveError && <p className="error-text">{saveError}</p>}
          </>
        ) : (
          <Tag
            className={revision || b.type === "code" ? "" : "pending-text"}
            onClick={() => {
              if (translatable(b)) {
                setText(revision?.text || "");
                setEditing(true);
              }
            }}
          >
            {b.type === "code"
              ? b.text
              : revision?.text ||
                "译文将在这里出现。连接模型后开始试译，也可点击手动填写。"}
          </Tag>
        )}
        {p.errors[b.id] && <p className="error-text">{p.errors[b.id]}</p>}
        {candidate && candidate.createdAt > (revision?.createdAt || 0) && (
          <details className="candidate">
            <summary>查看重译候选 · 原人工稿保留</summary>
            <p>{candidate.text}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onAccept(candidate.id)}
            >
              采用候选译文
            </Button>
          </details>
        )}
      </div>
    </article>
  );
}

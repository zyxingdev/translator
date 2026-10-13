import {
  type Project,
  type Attempt,
  uid,
  translatable,
  estimateTokens,
} from "./types";
import {
  getProject,
  mutateProject,
  acquireLease,
  renewLease,
  releaseLease,
} from "./store";
import { translateBlocks, ApiError } from "./providers";
import { protect, applicableTerms } from "./glossary";
import { splitText } from "./parser";
import { hash } from "./security";
export const priceCost = (
  input: number | null,
  output: number | null,
  inPrice: number | null,
  outPrice: number | null,
) =>
  input === null || output === null || inPrice === null || outPrice === null
    ? null
    : (input * inPrice + output * outPrice) / 1e6;
export function totals(p: Project) {
  return {
    known: p.attempts.reduce((n, a) => n + (a.cost ?? 0), 0),
    unknown: p.attempts.filter((a) => a.cost === null).length,
    reserved: p.attempts
      .filter(
        (a) => a.state === "sent" || a.state === "unknown" || a.cost === null,
      )
      .reduce((n, a) => n + a.reserved, 0),
    tokens: p.attempts.reduce(
      (n, a) =>
        n +
        (a.inputTokens !== null && a.outputTokens !== null
          ? a.inputTokens + a.outputTokens
          : a.reservedTokens),
      0,
    ),
    requests: p.attempts.length,
  };
}
export function checkBudget(p: Project, reserved: number, tokens: number) {
  const t = totals(p);
  if (t.requests >= p.config.maxRequests)
    throw Error("达到请求数量限制，请增加限额后继续");
  if (t.tokens + tokens > p.config.maxTokens)
    throw Error("下一请求将超过 token 软限制，请调整后继续");
  if (
    p.config.inputPrice !== null &&
    p.config.outputPrice !== null &&
    t.known + t.reserved + reserved > p.config.budget
  )
    throw Error("下一请求将超过本地软预算，请提高预算后继续");
}
export class TranslationController {
  private stopped = false;
  private abort?: AbortController;
  private active = false;
  private emergency?: Project;
  constructor(
    private onUpdate: (p: Project) => void,
    private onError: (message: string) => void,
  ) {}
  get emergencyProject() {
    return this.emergency;
  }
  get isRunning() {
    return this.active;
  }
  pause() {
    this.stopped = true;
  }
  cancel() {
    this.stopped = true;
    this.abort?.abort();
  }
  async run(
    id: string,
    key: string,
    verified: string,
    mode: "all" | "trial" | "retry" = "all",
    blockId?: string,
  ) {
    if (this.active) throw Error("一次只能执行一个任务");
    let p = await getProject(id);
    if (!p) throw Error("项目不存在");
    if (!key.trim() || verified !== `${p.config.provider}:${p.config.model}`)
      throw Error("请先输入 Key 并测试当前供应商与模型连接");
    if (p.demo) throw Error("演示稿不发起模型请求，请选择自己的文档");
    this.active = true;
    this.stopped = false;
    this.emergency = undefined;
    let ownedEpoch: number | undefined;
    const execute = async () => {
      const lease = await acquireLease("global-translation");
      let taskEpoch = 0;
      let lockError = "";
      const heartbeat = setInterval(() => {
        renewLease("global-translation", lease).catch(() => {
          lockError = "执行锁已失效，任务已暂停";
          this.cancel();
        });
      }, 4000);
      try {
        p = await mutateProject(id, (current) => {
          current.attempts
            .filter((a) => a.state === "sent")
            .forEach((a) => (a.state = "unknown"));
          if (current.attempts.some((a) => a.state === "unknown"))
            throw Error(
              "存在结果未知的调用。请在费用面板检查，并明确允许重试后继续",
            );
          current.epoch++;
          taskEpoch = current.epoch;
          ownedEpoch = taskEpoch;
          current.state = "running";
          current.message =
            mode === "trial"
              ? "正在试译，结果可复用于整篇"
              : "正在翻译，请保持页面在前台";
        });
        this.onUpdate(p);
        let blocks = p.doc.blocks.filter(translatable);
        if (blockId) blocks = blocks.filter((b) => b.id === blockId);
        else blocks = blocks.filter((b) => !p!.completed.includes(b.id));
        if (mode === "trial")
          blocks = blocks
            .filter(
              (b) =>
                p!.doc.format !== "pdf" ||
                Number(b.sectionId.split("-")[1]) <= 2,
            )
            .slice(0, 3);
        const retries = new Map<string, number>();
        for (let bi = 0; bi < blocks.length; bi++) {
          const b = blocks[bi];
          if (this.stopped || document.hidden) break;
          await renewLease("global-translation", lease);
          p = (await getProject(id))!;
          if (!p || p.epoch !== taskEpoch) break;
          const protectedText = protect(
            b.text,
            b.spans?.filter((s) => s.protected).map((s) => s.text) || [],
          );
          const previous =
            p.doc.blocks
              .filter(
                (x) =>
                  x.sectionId === b.sectionId &&
                  x.order < b.order &&
                  translatable(x),
              )
              .at(-1)?.text || "";
          const next =
            p.doc.blocks.find(
              (x) =>
                x.sectionId === b.sectionId &&
                x.order > b.order &&
                translatable(x),
            )?.text || "";
          const terms = applicableTerms(
            b.text,
            p.config.glossary,
            p.config.direction,
          );
          const context = JSON.stringify({
            title: p.doc.title,
            chapter: p.doc.sections.find((s) => s.id === b.sectionId)?.title,
            background: p.config.background.slice(0, 1500),
            terms,
            previous: previous.slice(-450),
            next: next.slice(0, 450),
          });
          const requestHash = await hash(p.configHash + b.text + context);
          const previousResult = p.revisions.find(
            (r) =>
              r.blockId === b.id &&
              r.configHash === requestHash &&
              r.origin === "model",
          );
          if (previousResult && !blockId) {
            p = await mutateProject(
              id,
              (x) => {
                if (!x.completed.includes(b.id)) x.completed.push(b.id);
              },
              taskEpoch,
            );
            this.onUpdate(p);
            continue;
          }
          const input = estimateTokens(context + protectedText.text) + 500,
            output = 8192,
            reservedTokens = input + output;
          const reserve =
            priceCost(
              input,
              output,
              p.config.inputPrice,
              p.config.outputPrice,
            ) ?? 0;
          const attempt: Attempt = {
            id: uid(),
            blockId: b.id,
            state: "sent",
            sentAt: Date.now(),
            inputTokens: null,
            outputTokens: null,
            cost: null,
            reserved: reserve,
            reservedTokens,
            error: undefined,
            configHash: requestHash,
            priceVersion: p.config.priceVersion,
            currency: p.config.currency,
            inputPrice: p.config.inputPrice,
            outputPrice: p.config.outputPrice,
            epoch: taskEpoch,
          };
          p = await mutateProject(
            id,
            (x) => {
              checkBudget(x, reserve, reservedTokens);
              x.attempts.push(attempt);
              x.message = `正在翻译：${b.locator}`;
            },
            taskEpoch,
          );
          this.onUpdate(p);
          this.abort = new AbortController();
          const timer = setTimeout(() => this.abort?.abort(), 120000);
          let translated = "",
            usage: { input: number | null; output: number | null } | undefined;
          try {
            const result = await translateBlocks(
              p.config,
              key,
              b.id,
              protectedText.text,
              context,
              this.abort.signal,
            );
            usage = result.usage;
            translated = protectedText.restore(result.text);
          } catch (e) {
            clearTimeout(timer);
            const error =
              e instanceof ApiError
                ? e
                : new ApiError(
                    "validation",
                    e instanceof Error ? e.message : "模型结果校验失败",
                  );
            const u = usage || (e as any).usage;
            await renewLease("global-translation", lease);
            p = await mutateProject(
              id,
              (x) => {
                const a = x.attempts.find((a) => a.id === attempt.id)!;
                a.state = error.category === "unknown" ? "unknown" : "failed";
                a.error = error.message;
                if (u) {
                  a.inputTokens = u.input;
                  a.outputTokens = u.output;
                  a.cost = priceCost(
                    u.input,
                    u.output,
                    a.inputPrice,
                    a.outputPrice,
                  );
                }
                x.errors[b.id] = error.message;
                x.state = "paused";
                x.message = error.message;
              },
              taskEpoch,
            );
            this.onUpdate(p);
            const count = retries.get(b.id) || 0;
            if (error.category === "truncated" && b.text.length > 500) {
              const parts = splitText(
                b.text,
                Math.max(400, Math.floor(b.text.length / 2)),
              );
              const children = parts.map((text, i) => ({
                ...b,
                id: i ? `${b.id}-part${uid().slice(0, 8)}` : b.id,
                text,
                flags: [...b.flags, "输出截断后分块"],
              }));
              p = await mutateProject(
                id,
                (x) => {
                  const at = x.doc.blocks.findIndex((x) => x.id === b.id);
                  x.doc.blocks.splice(at, 1, ...children);
                  x.doc.blocks.forEach((b, i) => (b.order = i));
                  x.state = "running";
                  x.message = "输出截断，已拆分原文块；原调用仍计入用量。";
                },
                taskEpoch,
              );
              blocks.splice(bi, 1, ...children);
              bi--;
              this.onUpdate(p);
              continue;
            }
            if (
              ((error.category === "rate" || error.category === "server") &&
                count < 3) ||
              (error.category === "validation" && count < 1)
            ) {
              retries.set(b.id, count + 1);
              p = await mutateProject(
                id,
                (x) => {
                  x.state = "running";
                  x.message = `${error.message} 正在等待重试 ${count + 1}，重试计入预算。`;
                },
                taskEpoch,
              );
              this.onUpdate(p);
              const delay =
                error.category === "validation"
                  ? 0
                  : Math.max(
                      error.retryAfter * 1000,
                      Math.min(30000, 2000 * 2 ** count + Math.random() * 1000),
                    );
              await new Promise<void>((resolve) => {
                const started = Date.now();
                const interval = setInterval(() => {
                  if (
                    this.stopped ||
                    document.hidden ||
                    Date.now() - started >= delay
                  ) {
                    clearInterval(interval);
                    resolve();
                  }
                }, 100);
              });
              bi--;
              continue;
            }
            this.onError(error.message);
            this.stopped = true;
            break;
          } finally {
            clearTimeout(timer);
          }
          // Keep recoverable response in memory before committing to IndexedDB.
          const commit = (x: Project) => {
            const a = x.attempts.find((a) => a.id === attempt.id)!;
            a.state = "success";
            a.inputTokens = usage!.input;
            a.outputTokens = usage!.output;
            a.cost = priceCost(
              a.inputTokens,
              a.outputTokens,
              a.inputPrice,
              a.outputPrice,
            );
            const manual = x.revisions.some(
              (r) => r.blockId === b.id && r.origin === "manual",
            );
            x.revisions.push({
              id: uid(),
              blockId: b.id,
              text: translated,
              origin: manual || mode === "retry" ? "candidate" : "model",
              version: x.revisions.filter((r) => r.blockId === b.id).length + 1,
              createdAt: Date.now(),
              configHash: requestHash,
            });
            if (!x.completed.includes(b.id)) x.completed.push(b.id);
            delete x.errors[b.id];
            const violations = terms.filter(
              (t) => !translated.toLowerCase().includes(t.target.toLowerCase()),
            );
            x.message = violations.length
              ? `已保存；请检查术语：${violations.map((t) => t.target).join("、")}`
              : `已保存：${b.locator}`;
          };
          const memory = structuredClone((await getProject(id))!);
          commit(memory);
          try {
            await renewLease("global-translation", lease);
            p = await mutateProject(id, commit, taskEpoch);
          } catch (e) {
            if (!lockError && (await getProject(id))) {
              this.emergency = memory;
              this.onUpdate({
                ...memory,
                state: "paused",
                message: "译文尚未可靠保存。已停止新请求，请下载应急备份。",
              });
            }
            throw e;
          }
          this.onUpdate(p);
        }
        if (!this.emergency) {
          p = await mutateProject(
            id,
            (x) => {
              const all = x.doc.blocks
                .filter(translatable)
                .every((b) => x.completed.includes(b.id));
              x.state = all ? "completed" : "paused";
              if (!all && !Object.keys(x.errors).length)
                x.message = document.hidden
                  ? "页面已隐藏，已暂停新请求。请回到前台后手动继续。"
                  : this.stopped
                    ? "已暂停；正在进行的请求已处理，保存的段落不会重复翻译。"
                    : mode === "trial"
                      ? "试译完成，满意后可继续全文翻译。"
                      : "任务已暂停。";
            },
            taskEpoch,
          );
          this.onUpdate(p);
        }
      } finally {
        clearInterval(heartbeat);
        await releaseLease("global-translation", lease);
      }
    };
    try {
      if (navigator.locks)
        await navigator.locks.request(
          "yiye-global-translation",
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw Error("另一标签正在执行翻译");
            await execute();
          },
        );
      else await execute();
    } catch (e) {
      const message = lockErrorSafe(e);
      if (!this.emergency) {
        try {
          const current = await getProject(id);
          if (
            current?.state === "running" &&
            ownedEpoch !== undefined &&
            current.epoch === ownedEpoch
          ) {
            const updated = await mutateProject(id, (x) => {
              x.state = "paused";
              x.message = message;
            });
            this.onUpdate(updated);
          }
        } catch {}
      }
      this.onError(message);
    } finally {
      this.active = false;
      this.abort = undefined;
      key = "";
    }
  }
}
const lockErrorSafe = (e: unknown) =>
  e instanceof Error ? e.message : "任务中断，请检查项目状态";
export async function acknowledgeUnknown(id: string) {
  return mutateProject(id, (p) => {
    p.attempts
      .filter((a) => a.state === "unknown")
      .forEach((a) => {
        a.state = "failed";
        a.error = "用户允许重试；原调用仍可能计费，保留预留费用";
      });
    p.state = "paused";
    p.message = "已允许手动重试。原调用费用预留仍保留。";
  });
}

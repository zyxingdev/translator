import Dexie, { type EntityTable } from "dexie";
import { type Project, type Config, uid } from "./types";
import { hash } from "./security";
interface Lease {
  id: string;
  tab: string;
  epoch: number;
  expires: number;
}
interface Tombstone {
  id: string;
  epoch: number;
}
export const db = new Dexie("yiye-projects-v1") as Dexie & {
  projects: EntityTable<Project, "id">;
  leases: EntityTable<Lease, "id">;
  tombstones: EntityTable<Tombstone, "id">;
};
db.version(1).stores({
  projects: "id,savedAt,state",
  leases: "id",
  tombstones: "id",
});
const session = new Map<string, Project>();
const deleted = new Set<string>();
export const tabId = uid();
export const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("yiye-events")
    : null;
export async function getProject(id: string) {
  return session.get(id) || (await db.projects.get(id));
}
export async function listProjects() {
  const saved = await db.projects.toArray();
  return [...saved.filter((p) => !session.has(p.id)), ...session.values()].sort(
    (a, b) => b.savedAt - a.savedAt,
  );
}
export async function storageCheck(bytes = 0) {
  if (navigator.storage?.estimate) {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota && quota - (usage || 0) < bytes * 2)
      throw Error("可估存储余量不足，请选择仅本次会话或清理其他项目");
  }
  await db.transaction("rw", db.leases, async () => {
    await db.leases.put({
      id: `probe-${tabId}`,
      tab: tabId,
      epoch: 0,
      expires: 0,
    });
    await db.leases.delete(`probe-${tabId}`);
  });
}
export async function putProject(p: Project) {
  if (deleted.has(p.id)) throw Error("项目已删除");
  if (p.storage === "local") {
    if (await db.tombstones.get(p.id)) throw Error("项目已删除");
    await db.projects.put(p);
    session.delete(p.id);
  } else {
    if (db.isOpen()) await db.projects.delete(p.id);
    session.set(p.id, structuredClone(p));
  }
  channel?.postMessage({ id: p.id });
}
export async function mutateProject(
  id: string,
  fn: (p: Project) => void,
  epoch?: number,
): Promise<Project> {
  const inSession = session.get(id);
  if (inSession) {
    if (deleted.has(id) || (epoch !== undefined && inSession.epoch !== epoch))
      throw Error("任务已失效");
    const p = structuredClone(inSession);
    fn(p);
    p.savedAt = Date.now();
    session.set(id, p);
    return p;
  }
  return db.transaction("rw", db.projects, db.tombstones, async () => {
    const p = await db.projects.get(id);
    if (
      !p ||
      (await db.tombstones.get(id)) ||
      (epoch !== undefined && p.epoch !== epoch)
    )
      throw Error("项目已删除或执行版本已失效");
    fn(p);
    p.savedAt = Date.now();
    await db.projects.put(p);
    channel?.postMessage({ id });
    return p;
  });
}
export async function deleteProject(id: string) {
  deleted.add(id);
  session.delete(id);
  await db.transaction(
    "rw",
    db.projects,
    db.tombstones,
    db.leases,
    async () => {
      const p = await db.projects.get(id);
      await db.tombstones.put({ id, epoch: (p?.epoch || 0) + 1 });
      await db.projects.delete(id);
      await db.leases.delete(id);
    },
  );
  channel?.postMessage({ id, deleted: true });
}
export async function clearProjects() {
  const all = await listProjects();
  for (const p of all) await deleteProject(p.id);
  await db.leases.clear();
}
export const configHash = (c: Config) =>
  hash(
    JSON.stringify({
      provider: c.provider,
      model: c.model,
      direction: c.direction,
      style: c.style,
      glossary: c.glossary,
      background: c.background,
      promptVersion: c.promptVersion,
    }),
  );
export async function applyConfig(id: string, config: Config) {
  const newHash = await configHash(config);
  return mutateProject(id, (p) => {
    if (p.state === "running") throw Error("请先暂停任务再更改配置");
    p.config = config;
    if (newHash !== p.configHash) {
      p.configHash = newHash;
      p.completed = [];
      p.errors = {};
      p.state = "ready";
      p.message = "配置已更新。原译稿保留，新任务将按新配置翻译。";
    }
  });
}
export async function acquireLease(id: string) {
  const now = Date.now();
  return db.transaction("rw", db.leases, async () => {
    const lease = await db.leases.get(id);
    if (lease && lease.expires > now && lease.tab !== tabId)
      throw Error("另一标签正在执行任务，请在该页面暂停或等待锁释放");
    const epoch = (lease?.epoch || 0) + 1;
    await db.leases.put({ id, tab: tabId, epoch, expires: now + 15000 });
    return epoch;
  });
}
export async function renewLease(id: string, epoch: number) {
  await db.transaction("rw", db.leases, async () => {
    const l = await db.leases.get(id);
    if (!l || l.tab !== tabId || l.epoch !== epoch || l.expires < Date.now())
      throw Error("执行锁已失效");
    l.expires = Date.now() + 15000;
    await db.leases.put(l);
  });
}
export async function releaseLease(id: string, epoch: number) {
  await db.transaction("rw", db.leases, async () => {
    const l = await db.leases.get(id);
    if (l?.tab === tabId && l.epoch === epoch) await db.leases.delete(id);
  });
}
export async function saveManual(id: string, blockId: string, text: string) {
  return mutateProject(id, (p) => {
    const old = p.revisions.filter((r) => r.blockId === blockId);
    p.revisions.push({
      id: uid(),
      blockId,
      text,
      origin: "manual",
      version: old.length + 1,
      createdAt: Date.now(),
      configHash: p.configHash,
    });
  });
}
export async function acceptCandidate(id: string, revisionId: string) {
  return mutateProject(id, (p) => {
    const r = p.revisions.find((r) => r.id === revisionId);
    if (!r) return;
    p.revisions.push({
      ...r,
      id: uid(),
      origin: "manual",
      version: p.revisions.filter((x) => x.blockId === r.blockId).length + 1,
      createdAt: Date.now(),
    });
  });
}

export async function recoverProject(id: string) {
  const p = await getProject(id);
  if (!p || p.state !== "running") return p;
  const lease = await db.leases.get("global-translation");
  if (lease && lease.expires > Date.now()) return p;
  return mutateProject(
    id,
    (x) => {
      x.state = "interrupted";
      x.epoch++;
      x.attempts
        .filter((a) => a.state === "sent")
        .forEach((a) => (a.state = "unknown"));
      x.message =
        "上次任务已中断。已提交译稿保留，请重输 Key 并检查未知调用，再手动继续。";
    },
    p.epoch,
  );
}

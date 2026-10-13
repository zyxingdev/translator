import { parseDocument } from "../lib/parser";
import { exportProject, createBackup, importBackup } from "../lib/exporter";
self.onmessage = async ({ data }) => {
  const { request_id, operation, payload, project_id } = data;
  try {
    const progress = (n: number, label: string) =>
      self.postMessage({
        request_id,
        project_id,
        operation,
        schema_version: 1,
        progress: n,
        label,
      });
    let result: any;
    if (operation === "parse")
      result = await parseDocument(
        payload.bytes,
        payload.name,
        payload.mobile,
        progress,
        payload.assetBase,
      );
    else if (operation === "export")
      result = await exportProject(
        payload.project,
        payload.format,
        payload.bilingual,
        progress,
        payload.font,
      );
    else if (operation === "backup")
      result = await createBackup(payload.project);
    else if (operation === "import") result = await importBackup(payload.bytes);
    else throw Error("未知 Worker 操作");
    self.postMessage({
      request_id,
      project_id,
      operation,
      schema_version: 1,
      result,
    });
  } catch (e) {
    self.postMessage({
      request_id,
      project_id,
      operation,
      schema_version: 1,
      error_category: "document",
      error: e instanceof Error ? e.message : "文档处理失败",
    });
  }
};

import { uid } from "./types";
export function workerCall<T>(
  operation: string,
  payload: any,
  onProgress?: (n: number, label: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/document.worker.ts", import.meta.url),
      { type: "module" },
    );
    const request_id = uid();
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(Error("操作已取消"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("文档处理超过 120 秒，已停止。请尝试更小文件。"));
    }, 120000);
    signal?.addEventListener("abort", abort);
    worker.onerror = () => {
      finish();
      reject(Error("文档处理线程失败"));
    };
    worker.onmessage = ({ data }) => {
      if (data.request_id !== request_id) return;
      if (data.progress !== undefined) onProgress?.(data.progress, data.label);
      else {
        finish();
        data.error ? reject(Error(data.error)) : resolve(data.result);
      }
    };
    worker.postMessage({
      request_id,
      project_id: payload.project?.id || null,
      operation,
      schema_version: 1,
      payload,
    });
  });
}

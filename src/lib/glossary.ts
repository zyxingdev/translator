import type { Term } from "./types";
export function parseCSV(text: string): Term[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quote) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quote) throw Error("CSV 引号未闭合");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift()?.map((x) => x.trim().replace(/^\uFEFF/, ""));
  if (!header?.includes("source") || !header.includes("target"))
    throw Error("CSV 需要 source、target 列");
  if (rows.length > 500) throw Error("术语最多 500 条");
  const seen = new Map<string, string>();
  return rows
    .filter((r) => r.some(Boolean))
    .map((r, i) => {
      const get = (k: string) => r[header.indexOf(k)]?.trim() || "";
      const source = get("source"),
        target = get("target"),
        direction = get("direction") || "both",
        mode = get("match_mode") || "word";
      if (!source || !target || source.length > 200 || target.length > 200)
        throw Error(`第 ${i + 2} 行：术语不能为空且不得超过 200 字`);
      if (
        !["both", "en-zh", "zh-en"].includes(direction) ||
        !["word", "substring"].includes(mode)
      )
        throw Error(`第 ${i + 2} 行：方向或匹配模式无效`);
      const key = source.toLowerCase() + ":" + direction;
      if (seen.has(key) && seen.get(key) !== target)
        throw Error(`第 ${i + 2} 行：同源术语译法冲突`);
      seen.set(key, target);
      return {
        source,
        target,
        direction: direction as Term["direction"],
        case_sensitive: get("case_sensitive") === "true",
        match_mode: mode as Term["match_mode"],
        note: get("note"),
      };
    });
}
export function applicableTerms(
  text: string,
  terms: Term[],
  direction: string,
) {
  return terms
    .filter((t) => {
      if (t.direction !== "both" && t.direction !== direction) return false;
      const s = t.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        t.match_mode === "word" && /^[a-z]/i.test(t.source)
          ? `(?<![\\w])${s}(?![\\w])`
          : s,
        t.case_sensitive ? "" : "i",
      ).test(text);
    })
    .sort((a, b) => b.source.length - a.source.length);
}
export function protect(text: string, extra: string[] = []) {
  const values: string[] = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  const pattern =
    "```[\\s\\S]*?```|`[^`]+`|\\$\\$[\\s\\S]*?\\$\\$|\\$[^$\\n]+\\$|https?:\\/\\/[^\\s<>]+|\\b\\d+(?:[.,]\\d+)*(?:%|°[CF])?";
  const extras = extra
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const result = text.replace(
    new RegExp([...extras, pattern].join("|"), "g"),
    (v) => {
      values.push(v);
      return `⟦Y${nonce}_${values.length - 1}⟧`;
    },
  );
  return {
    text: result,
    restore: (output: string) => {
      for (let i = 0; i < values.length; i++) {
        const token = `⟦Y${nonce}_${i}⟧`;
        if (output.split(token).length !== 2)
          throw Error("模型输出丢失或重复受保护内容");
        output = output.replace(token, values[i]);
      }
      if (/⟦Y[^⟧]+⟧/.test(output)) throw Error("模型输出包含未知占位符");
      return output;
    },
  };
}

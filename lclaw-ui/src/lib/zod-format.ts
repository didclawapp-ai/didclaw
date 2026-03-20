import type { ZodError } from "zod";

/** 将 Zod 校验失败压缩为一行用户可见说明 */
export function formatZodIssues(err: ZodError): string {
  return err.issues
    .map((i) => {
      const p = i.path.length ? i.path.join(".") : "root";
      return `${p}: ${i.message}`;
    })
    .join("; ");
}

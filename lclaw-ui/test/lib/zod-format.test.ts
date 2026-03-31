import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodIssues } from "@/lib/zod-format";

function parseAndGetError(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error("Expected validation to fail");
  }
  return result.error;
}

describe("formatZodIssues", () => {
  it("formats a single root-level issue", () => {
    const schema = z.string();
    const err = parseAndGetError(schema, 42);
    const result = formatZodIssues(err);
    expect(result).toMatch(/^root: .+string/i);
  });

  it("formats a nested field path", () => {
    const schema = z.object({ user: z.object({ name: z.string() }) });
    const err = parseAndGetError(schema, { user: { name: 123 } });
    const result = formatZodIssues(err);
    expect(result).toMatch(/^user\.name: /);
  });

  it("joins multiple issues with semicolons", () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    const err = parseAndGetError(schema, { a: 1, b: "x" });
    const result = formatZodIssues(err);
    expect(result).toContain("a:");
    expect(result).toContain("b:");
    expect(result).toContain("; ");
  });

  it("uses 'root' path label when issue has no path", () => {
    const schema = z.string().min(10);
    const err = parseAndGetError(schema, "short");
    expect(formatZodIssues(err)).toMatch(/^root:/);
  });

  it("handles array index in path", () => {
    const schema = z.array(z.string());
    const err = parseAndGetError(schema, ["ok", 99]);
    expect(formatZodIssues(err)).toContain("1:");
  });
});

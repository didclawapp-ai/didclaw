/**
 * Extract unified diff bodies from assistant text fenced as ```diff / ```udiff / ```patch / ```didclaw-patch.
 */
const FENCE_INNER_RE =
  /```\s*(?:diff|udiff|patch|didclaw-patch)\s*\n([\s\S]*?)```/gi;

export function extractCompleteDiffBlocksFromText(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(FENCE_INNER_RE.source, FENCE_INNER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1]?.trimEnd() ?? "";
    if (body.length > 0) {
      out.push(`${body}\n`);
    }
  }
  return out;
}

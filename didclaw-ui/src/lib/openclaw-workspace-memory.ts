export type WorkspaceMemoryFileRow = {
  name: string;
  path: string;
  modifiedMs: number;
  size: number;
};

/** Build a file:// URL for `preview_open_local` (Windows drive letters and POSIX). */
export function absolutePathToFileUrl(abs: string): string {
  const normalized = abs.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

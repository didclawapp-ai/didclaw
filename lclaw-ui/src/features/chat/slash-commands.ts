/** Slash 命令定义，供 SlashCommandPicker 和 MessageComposer 共用。*/

export interface SlashCommand {
  /** 命令全称，含 `/` 前缀，如 `/new` */
  command: string;
  /** i18n 描述键（`slash.<name>`） */
  descKey: string;
  /** 参数占位提示，仅用于 UI 展示，如 ` <内容>` */
  argHint?: string;
  /**
   * 选中后光标停在末尾并附加一个空格，让用户继续输入参数。
   * 无 args 的命令选中后直接可发送。
   */
  hasArgs?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/new",      descKey: "slash.new" },
  { command: "/remember", descKey: "slash.remember", argHint: " <内容>", hasArgs: true },
  { command: "/forget",   descKey: "slash.forget",   argHint: " <内容>", hasArgs: true },
  { command: "/status",   descKey: "slash.status" },
  { command: "/usage",    descKey: "slash.usage" },
  { command: "/model",    descKey: "slash.model",    argHint: " <模型名>", hasArgs: true },
];

/**
 * 根据用户当前输入的草稿，返回 slash 查询字符串；
 * 若草稿不符合触发条件则返回 null。
 *
 * 触发条件：草稿以 `/` 开头，且不含换行（slash 命令是单行指令）。
 */
export function extractSlashQuery(draft: string): string | null {
  if (!draft.startsWith("/")) return null;
  if (draft.includes("\n")) return null;
  return draft.slice(1);
}

/** 根据查询字符串过滤命令列表（大小写不敏感）。 */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(q));
}

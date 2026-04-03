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
  /**
   * 风险等级，用于 picker 中的字体颜色提示：
   * - `safe`（绿）：只读或可撤销，普通用户随意使用
   * - `caution`（黄）：可逆但有影响，如切换模型
   * - `danger`（红）：不可逆或影响较大，如结束会话、删除记忆
   */
  risk?: "safe" | "caution" | "danger";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/new",      descKey: "slash.new",      risk: "danger" },
  { command: "/remember", descKey: "slash.remember", argHint: " <内容>",  hasArgs: true, risk: "safe" },
  { command: "/forget",   descKey: "slash.forget",   argHint: " <内容>",  hasArgs: true, risk: "danger" },
  { command: "/status",   descKey: "slash.status",   risk: "safe" },
  { command: "/usage",    descKey: "slash.usage",    risk: "safe" },
  { command: "/model",    descKey: "slash.model",    argHint: " <模型名>", hasArgs: true, risk: "caution" },
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

/**
 * 草稿是否已是「可直接发送」的斜杠命令（选择器仍可能打开时，Enter 应变发送而非补全）。
 * 无参命令：整行等于该命令（忽略首尾空白，命令名大小写不敏感）。
 * 有参命令：`/cmd` + 空格 + 非空参数。
 */
export function isSlashDraftReadyToSend(draft: string): boolean {
  const t = draft.trim();
  if (!t.startsWith("/")) return false;
  for (const cmd of SLASH_COMMANDS) {
    const nameLower = cmd.command.toLowerCase();
    const tLower = t.toLowerCase();
    if (cmd.hasArgs) {
      if (t.length <= cmd.command.length) continue;
      if (t[cmd.command.length] !== " ") continue;
      if (t.slice(0, cmd.command.length).toLowerCase() !== nameLower) continue;
      if (t.slice(cmd.command.length + 1).trim().length > 0) return true;
    } else if (tLower === nameLower) {
      return true;
    }
  }
  return false;
}

import { defineStore } from "pinia";
import { ref } from "vue";

/** Gateway `exec.approval.requested` 事件 payload 的关键字段 */
export interface ExecApprovalRequest {
  approvalId: string;
  sessionKey?: string;
  agentId?: string;
  systemRunPlan?: {
    argv?: string[];
    cwd?: string;
    rawCommand?: string;
  };
}

export type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export const useApprovalStore = defineStore("approval", () => {
  /** 等待响应的审批队列（按到达顺序排列，UI 展示最先到达的那条） */
  const pending = ref<ExecApprovalRequest[]>([]);

  function addPending(req: ExecApprovalRequest): void {
    if (pending.value.find((p) => p.approvalId === req.approvalId)) return;
    pending.value = [...pending.value, req];
  }

  function removePending(approvalId: string): void {
    pending.value = pending.value.filter((p) => p.approvalId !== approvalId);
  }

  return { pending, addPending, removePending };
});

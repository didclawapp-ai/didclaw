import { getDidClawDesktopApi } from "@/lib/desktop-api";
import { ref } from "vue";

const aiName = ref<string | null>(null);
const userName = ref<string | null>(null);
let loaded = false;

export function useWorkspaceIdentity() {
  async function loadIdentity() {
    if (loaded) return;
    loaded = true;
    try {
      const api = getDidClawDesktopApi();
      const r = await api?.readWorkspaceIdentity?.();
      if (r?.ok) {
        aiName.value = r.aiName ?? null;
        userName.value = r.userName ?? null;
      }
    } catch {
      // silently ignore; fallback to defaults
    }
  }

  /** tag text for a given role */
  function roleLabel(role: "user" | "assistant" | "system" | string): string {
    if (role === "assistant") return aiName.value ?? "ASSISTANT";
    if (role === "user") return userName.value ?? "USER";
    return role.toUpperCase();
  }

  return { aiName, userName, loadIdentity, roleLabel };
}

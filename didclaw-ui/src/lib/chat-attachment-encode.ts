import { i18n } from "@/i18n";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { sniffImageMimeFromHeader } from "@/lib/chat-image-sniff";

/** Aligned with gateway `parseMessageWithAttachments` default limit (~5 MB decoded) */
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 4_500_000;

export type GatewayChatAttachmentPayload = {
  type?: string;
  mimeType: string;
  fileName: string;
  content: string;
  /** Desktop: absolute path to the saved file (legacy client field) */
  filePath?: string;
  /** OpenClaw gateway expects `path` for local file refs (same as filePath when saved on disk) */
  path?: string;
};

/** Thrown when a file is not a supported image (e.g. PDF picked as “maybe image”). */
export class NotChatImageAttachmentError extends Error {
  override readonly name = "NotChatImageAttachmentError";
  constructor(message: string) {
    super(message);
  }
}

export async function ensureImageFileMimeType(file: File): Promise<File> {
  if (file.type.startsWith("image/")) {
    return file;
  }
  if (file.size < 6) {
    throw new NotChatImageAttachmentError(
      `${file.name || "image"}: ${i18n.global.t("chatAttach.onlyImages")}`,
    );
  }
  const header = await file.slice(0, 16).arrayBuffer();
  const mime = sniffImageMimeFromHeader(header);
  if (!mime) {
    throw new NotChatImageAttachmentError(
      `${file.name || "image"}: ${i18n.global.t("chatAttach.onlyImages")}`,
    );
  }
  return new File([file], file.name || "image", {
    type: mime,
    lastModified: file.lastModified,
  });
}

/** Extracts the bare base64 segment from a DataURL or raw base64 string (strips `data:...;base64,` prefix) */
export function readFileAsBase64Content(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const d = reader.result;
      if (typeof d !== "string") {
        reject(new Error("read failed"));
        return;
      }
      const i = d.indexOf(",");
      resolve(i >= 0 ? d.slice(i + 1) : d);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export async function buildImageAttachmentPayload(
  file: File,
): Promise<GatewayChatAttachmentPayload> {
  const f = await ensureImageFileMimeType(file);
  if (f.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`${f.name}: ${i18n.global.t("chatAttach.tooLarge")}`);
  }

  // Desktop: save to ~/.openclaw/workspace/.attachments/ and use file path
  const api = getDidClawDesktopApi();
  if (api?.saveChatAttachment) {
    const content = await readFileAsBase64Content(f);
    const res = await api.saveChatAttachment(content, f.name || "image.png");
    if (res.ok && typeof res.path === "string" && res.path.length > 0) {
      return {
        type: "image",
        mimeType: f.type || "image/png",
        fileName: f.name || "image",
        filePath: res.path,
        path: res.path,
        content: "",
      };
    }
  }

  // Fallback: inline base64
  const content = await readFileAsBase64Content(f);
  return {
    type: "image",
    mimeType: f.type || "image/png",
    fileName: f.name || "image",
    content,
  };
}

/** Append lines so the model / tools see absolute paths (gateway uses `path` on attachments; text helps agents that read the user message). */
export function appendLocalAttachmentPathsToMessage(
  message: string,
  attachments: GatewayChatAttachmentPayload[],
): string {
  const paths = attachments
    .map((a) => a.path ?? a.filePath)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length === 0) {
    return message;
  }
  const block = paths.map((p) => `[Attachment: ${p}]`).join("\n");
  const t = message.trim();
  return t ? `${t}\n\n${block}` : block;
}

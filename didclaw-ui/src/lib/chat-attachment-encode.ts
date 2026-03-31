import { i18n } from "@/i18n";

/** Aligned with gateway `parseMessageWithAttachments` default limit (~5 MB decoded) */
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 4_500_000;

export type GatewayChatAttachmentPayload = {
  type?: string;
  mimeType: string;
  fileName: string;
  content: string;
};

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
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name}: ${i18n.global.t("chatAttach.onlyImages")}`);
  }
  if (file.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`${file.name}: ${i18n.global.t("chatAttach.tooLarge")}`);
  }
  const content = await readFileAsBase64Content(file);
  return {
    type: "image",
    mimeType: file.type || "image/png",
    fileName: file.name || "image",
    content,
  };
}

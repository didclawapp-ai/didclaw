/** 与网关 `parseMessageWithAttachments` 默认上限对齐（解码后约 5MB） */
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 4_500_000;

export type GatewayChatAttachmentPayload = {
  type?: string;
  mimeType: string;
  fileName: string;
  content: string;
};

/** DataURL / 裸 base64 中的 base64 段（无 `data:...;base64,` 前缀） */
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
    throw new Error(`${file.name}：网关当前仅将图片作为附件传入多模态模型`);
  }
  if (file.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`${file.name}：超过约 4.5MB 上限，请压缩后重试`);
  }
  const content = await readFileAsBase64Content(file);
  return {
    type: "image",
    mimeType: file.type || "image/png",
    fileName: file.name || "image",
    content,
  };
}

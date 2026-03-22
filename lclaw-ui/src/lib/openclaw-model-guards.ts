/**
 * OpenClaw 主模型（`agents.defaults.model.primary`）走网关的**流式对话**链路
 *（Chat Completions + SSE）。部分厂商模型只有**非流式专用接口**（如智谱生图），
 * 不能用作主模型，否则会返回 400 等错误。
 */

/** 取 `provider/modelId` 中的 modelId（无斜杠则整体小写） */
function modelIdFromPrimaryRef(primaryRef: string): string {
  const lower = primaryRef.trim().toLowerCase();
  if (!lower) {
    return "";
  }
  const i = lower.lastIndexOf("/");
  return i >= 0 ? lower.slice(i + 1) : lower;
}

/**
 * 若该 primary 不能用于 OpenClaw 对话主模型，返回面向用户的说明；否则 `null`。
 */
export function describeOpenClawPrimaryModelIncompatibility(
  primaryRef: string,
): string | null {
  const id = modelIdFromPrimaryRef(primaryRef);
  if (id === "glm-image") {
    return (
      "glm-image 是智谱「图像生成」模型，官方接口为 POST /images/generations（一次 JSON，返回图片 URL），" +
      "不支持对话里的流式 Chat Completions（SSE）。把主模型设成 glm-image 时，网关仍会按对话流式调用，智谱会报 400「当前模型不支持 SSE 调用方式」。" +
      "请改用 glm-5、glm-4.7 等对话模型作为主模型；生图请用官方 images/generations、SDK 或后续工具/插件集成。"
    );
  }
  return null;
}

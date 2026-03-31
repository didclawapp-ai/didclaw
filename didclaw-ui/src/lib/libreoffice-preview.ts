/** 与主进程 `convertOfficeToPdfBuffer` 抛错/返回文案一致，用于右侧展示安装引导 */
export function isLibreOfficeMissingError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return /LibreOffice|LIBREOFFICE_PATH|soffice/i.test(message);
}

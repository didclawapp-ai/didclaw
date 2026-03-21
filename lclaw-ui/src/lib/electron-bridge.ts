export function isLclawElectron(): boolean {
  return typeof window !== "undefined" && window.lclawElectron?.isElectron === true;
}

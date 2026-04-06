import { ref } from "vue";

/** Persisted flag: show multi-agent (company / roles) entry points in the desktop shell. */
const LS_KEY = "didclaw.companyFeaturesUnlocked";

function loadFromStorage(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function persist(v: boolean): void {
  try {
    if (v) {
      localStorage.setItem(LS_KEY, "1");
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Shared ref: default off so shipping builds do not surface unfinished multi-agent UI. */
export const companyFeaturesUnlocked = ref(loadFromStorage());

export function setCompanyFeaturesUnlocked(on: boolean): void {
  companyFeaturesUnlocked.value = on;
  persist(on);
}

export function toggleCompanyFeaturesUnlocked(): void {
  setCompanyFeaturesUnlocked(!companyFeaturesUnlocked.value);
}

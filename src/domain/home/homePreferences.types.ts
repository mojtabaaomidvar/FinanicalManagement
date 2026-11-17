/** Personal navigation only: IDs and positions, never household records. */
export type HomeGroupId = "money" | "daily" | "belongings" | "family";

export interface HomePreferences {
  version: 1;
  layout: "grouped" | "flat";
  pins: string[];
  openGroups: string[];
  groupOrder: string[];
  groupModules: Record<HomeGroupId, string[]>;
  flatOrder: string[];
}

export interface HomePreferencesSnapshot {
  revision: number;
  preferences: HomePreferences | null;
}

import { addDays, jalaliToIso } from "@/shared/lib/jalali";
import { deriveNotifications, type DeriveInput } from "@/domain/notification/notification.rules";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type AppNotification,
  type NotificationPrefs,
} from "@/domain/notification/notification.types";

/** Inputs must already belong to the current authorized account and household. */
export type HomeOverviewInput = Pick<DeriveInput,
  "bills" | "events" | "tasks" | "equipment" | "vehicles" | "goals" | "activities"
  | "memberId" | "role" | "todayJ"
>;

export interface HomeOverview {
  overdue: AppNotification[];
  today: AppNotification[];
  upcoming: AppNotification[];
}

const HOME_PREFS: NotificationPrefs = {
  enabled: true,
  domains: {
    ...DEFAULT_NOTIFICATION_PREFS.domains,
    recurring: false,
    membership: false,
    documents: false,
  },
  leadDays: {
    ...DEFAULT_NOTIFICATION_PREFS.leadDays,
    bills: 1,
    event: 1,
    tasks: 1,
    equipment: 1,
    vehicles: 1,
    goals: 1,
    activities: 1,
  },
};

/** Reuse due-date, status, ownership and canonical target rules without muting work. */
export const deriveHomeOverview = (input: HomeOverviewInput): HomeOverview => {
  const overview: HomeOverview = { overdue: [], today: [], upcoming: [] };
  if (!input.memberId) return overview;
  const todayIso = jalaliToIso(input.todayJ);
  const horizonIso = jalaliToIso(addDays(input.todayJ, 1));
  const entries = deriveNotifications({
    ...input,
    txs: [], joinRequests: [], inventory: [], shoppingLists: [],
    prefs: HOME_PREFS,
    dismissed: new Set(),
    purpose: "home",
  });

  for (const entry of entries) {
    // Assignment reminders can include far-future or undated tasks; this is a deadline view.
    if (entry.ref.kind === "tasks"
      && (entry.dateIso === null || entry.dateIso > horizonIso)) continue;
    if (entry.severity === "overdue") overview.overdue.push(entry);
    // A vehicle may need service now because its odometer target has been reached.
    else if (entry.dateIso === todayIso
      || (entry.ref.kind === "vehicles" && entry.severity === "pending")) {
      overview.today.push(entry);
    } else if (entry.dateIso !== null && entry.dateIso > todayIso && entry.dateIso <= horizonIso) {
      overview.upcoming.push(entry);
    }
  }

  return overview;
};

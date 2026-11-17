import type { Bill } from "@/domain/bill/bill.types";
import type { Equipment } from "@/domain/equipment/equipment.types";
import type { Member } from "@/domain/family/family.types";
import type { NotificationRef } from "@/domain/notification/notification.types";
import type { Task } from "@/domain/task/task.types";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import { daysInMonth, isoToJalali, jalaliToIso } from "@/shared/lib/jalali";
import type { FamilyEvent } from "./event.types";

export type CalendarSource = "event" | "activity" | "task" | "bill" | "equipment" | "vehicle";
export type CalendarTarget = Extract<NotificationRef, {
  kind: "event" | "activities" | "tasks" | "bills" | "equipment" | "vehicles";
}>;

/** A view of an existing record, with no copied note, file or financial information. */
export interface CalendarEntry {
  id: string;
  date: string;
  title: string;
  source: CalendarSource;
  ref: CalendarTarget;
}

/** Every input must already be authorized for the current account and household. */
export interface HouseholdCalendarInput {
  events: readonly FamilyEvent[];
  /** Profiles and years are supplied only when projecting annual profile birthdays. */
  members?: readonly Pick<Member, "id" | "familyId" | "name" | "birthDate" | "status" | "membershipState" | "relation">[];
  birthdayYears?: readonly number[];
  tasks?: readonly Task[];
  bills?: readonly Bill[];
  equipment?: readonly Equipment[];
  vehicles?: readonly Vehicle[];
}

const validCalendarDate = (date: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
};

/** Calendar dates remain visible independently of notification preferences. */
export const deriveCalendarEntries = (input: HouseholdCalendarInput): CalendarEntry[] => {
  const entries = new Map<string, CalendarEntry>();
  const members = new Map((input.members ?? []).map((member) => [member.id, member]));
  // Four-digit Gregorian dates are the calendar's supported storage/display range.
  const birthdayYears = [...new Set(input.birthdayYears ?? [])]
    .filter((year) => Number.isInteger(year) && year >= 1 && year <= 9377);
  const add = (id: string, date: string | null, title: string, source: CalendarSource, ref: CalendarTarget) => {
    if (date === null || !validCalendarDate(date)) return;
    entries.set(id, { id, date, title, source, ref });
  };

  for (const event of input.events) {
    if (event.kind === "activity") {
      // Activities and ordinary events use the same canonical family_events identity.
      // Keep activity history; the calendar displays its current status from the source.
      add(`event:${event.id}`, event.date, event.title, "activity", { kind: "activities", activityId: event.id });
    } else {
      const member = event.forMemberId ? members.get(event.forMemberId) : undefined;
      const profileBirthday = input.birthdayYears !== undefined && member
        && member.familyId === event.familyId && event.title === `تولد ${member.name.trim()}`;
      if (profileBirthday) {
        const eligible = member.membershipState === "active" && (member.status === "active"
          || (member.status === "pending" && member.relation === "فرزند"));
        if (eligible && member.birthDate && validCalendarDate(member.birthDate)) {
          const [birthYear, month, day] = isoToJalali(member.birthDate);
          if (birthYear < 1 || birthYear > 9377) continue;
          for (const year of birthdayYears) {
            if (year <= birthYear) continue;
            // The same Esfand-30 rule as the server's next-birthday calculation.
            const occurrence = jalaliToIso([year, month, Math.min(day, daysInMonth(year, month))]);
            add(`event:${event.id}:birthday:${year}`, occurrence, event.title, "event", {
              kind: "event", eventId: event.id, dateIso: occurrence,
            });
          }
        }
        continue;
      }
      add(`event:${event.id}`, event.date, event.title, "event", { kind: "event", eventId: event.id, dateIso: event.date });
    }
  }
  for (const task of input.tasks ?? []) {
    if (!task.completed) {
      add(`task:${task.id}`, task.dueDate, task.title, "task", { kind: "tasks", taskId: task.id });
    }
  }
  for (const bill of input.bills ?? []) {
    if (bill.state === "unpaid") {
      add(`bill:${bill.id}`, bill.dueDate, bill.title, "bill", { kind: "bills", billId: bill.id, dueIso: bill.dueDate });
    }
  }
  for (const equipment of input.equipment ?? []) {
    for (const [reason, date] of [
      ["service", equipment.serviceDueDate], ["warranty", equipment.warrantyUntil],
    ] as const) {
      add(`equipment:${equipment.id}:${reason}`, date, equipment.title, "equipment", {
        kind: "equipment", equipmentId: equipment.id, reason,
      });
    }
  }
  for (const vehicle of input.vehicles ?? []) {
    // A mileage-only schedule has no calendar day and never receives an invented date.
    for (const [reason, date] of [
      ["service", vehicle.serviceDueDate], ["insurance", vehicle.insuranceUntil],
      ["inspection", vehicle.inspectionUntil],
    ] as const) {
      add(`vehicle:${vehicle.id}:${reason}`, date, vehicle.title, "vehicle", {
        kind: "vehicles", vehicleId: vehicle.id, reason,
      });
    }
  }

  // Calendar helpers filter this ordering; they do not sort source records themselves.
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
};

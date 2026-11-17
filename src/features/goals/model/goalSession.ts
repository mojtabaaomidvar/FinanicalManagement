import type { Goal } from "@/domain/goal/goal.types";

export interface GoalTicket { readonly scope: string; readonly ownerId: string }

/** Object identity also distinguishes disconnect/reconnect with the same owner. */
export class GoalSession {
  private ticket: GoalTicket = { scope: "", ownerId: "" };
  setScope(scope: string, ownerId: string): void {
    if (scope !== this.ticket.scope || ownerId !== this.ticket.ownerId) this.ticket = { scope, ownerId };
  }
  capture(): GoalTicket { return this.ticket; }
  invalidate(): void { this.ticket = { ...this.ticket }; }
  close(): void { this.ticket = { scope: "", ownerId: "" }; }
  isCurrent(ticket: GoalTicket): boolean { return ticket === this.ticket && Boolean(ticket.scope); }
  owns(ticket: GoalTicket, goal: Goal): boolean { return this.isCurrent(ticket) && goal.ownerId === ticket.ownerId; }
}

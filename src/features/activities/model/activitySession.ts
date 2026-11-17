export interface ActivityTicket { readonly scope: string }

/** Generation identity prevents responses from reviving cleared session data. */
export class ActivitySession {
  private ticket: ActivityTicket = { scope: "" };
  setScope(scope: string): void { if (scope !== this.ticket.scope) this.ticket = { scope }; }
  capture(): ActivityTicket { return this.ticket; }
  invalidate(): void { this.ticket = { ...this.ticket }; }
  close(): void { this.ticket = { scope: "" }; }
  isCurrent(ticket: ActivityTicket): boolean { return ticket === this.ticket && Boolean(ticket.scope); }
}

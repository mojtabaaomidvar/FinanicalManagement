export interface ChildTicket { readonly scope: string }

/** A new identity discards all snapshots, forms and pending responses. */
export class ChildSession {
  private ticket: ChildTicket = { scope: "" };
  setScope(scope: string): void { if (scope !== this.ticket.scope) this.ticket = { scope }; }
  capture(): ChildTicket { return this.ticket; }
  invalidate(): void { this.ticket = { ...this.ticket }; }
  close(): void { this.ticket = { scope: "" }; }
  isCurrent(ticket: ChildTicket): boolean { return ticket === this.ticket && Boolean(ticket.scope); }
}

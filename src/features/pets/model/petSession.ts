export interface PetTicket { readonly scope: string }

/** Generation identity revokes snapshots, dialogs and pending responses together. */
export class PetSession {
  private ticket: PetTicket = { scope: "" };
  setScope(scope: string): void { if (scope !== this.ticket.scope) this.ticket = { scope }; }
  capture(): PetTicket { return this.ticket; }
  invalidate(): void { this.ticket = { ...this.ticket }; }
  close(): void { this.ticket = { scope: "" }; }
  isCurrent(ticket: PetTicket): boolean { return ticket === this.ticket && Boolean(ticket.scope); }
}

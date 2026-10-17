/** A sign-out/account switch invalidates pending reads as well as rendered data.
 * A token refresh for the SAME user is not an account change. No tokens retained. */
export function reportSessionBoundary() {
  let userId: string | null | undefined;
  let revision = 0;
  return {
    change(next: string | null) {
      if (userId === next) return false;
      userId = next;
      revision++;
      return true;
    },
    ticket() {
      return { userId, revision };
    },
    current(ticket: { userId: string | null | undefined; revision: number }) {
      return (
        Boolean(userId) &&
        ticket.userId === userId &&
        ticket.revision === revision
      );
    },
  };
}

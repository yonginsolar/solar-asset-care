-- Explicit deny policies document the default-deny boundary for audit tools.
create policy no_direct_client_access on private.workflow_email_settings
 for all to anon,authenticated using(false) with check(false);
create policy no_direct_client_access on private.workflow_emails
 for all to anon,authenticated using(false) with check(false);

-- CLI-created migration aligned with its remote history version.
-- Document the private receipt boundary explicitly; no direct browser access.
create policy intake_receipts_no_direct_access on private.intake_requests
 for all to anon,authenticated using(false) with check(false);

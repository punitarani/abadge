-- §AB-0020 — enforce audit_logs append-only at the database.
--
-- audit_logs is append-only by convention only today: no trigger blocks
-- mutation, so a bug, a compromised Worker, or an insider could silently
-- UPDATE or DELETE audit rows and erase evidence of an unauthorized access —
-- voiding the product's "every access attempt is logged" guarantee with no
-- detection. A BEFORE UPDATE/DELETE trigger that RAISEs makes row mutation
-- impossible for ALL roles (it fires regardless of the connecting role),
-- so it does not depend on the least-privilege app role.
--
-- NOTE: TRUNCATE is not a row-level DELETE and bypasses row triggers (so test
-- truncation still works). Revoking UPDATE/DELETE/TRUNCATE from the
-- least-privilege application role is the complementary defense-in-depth and is
-- owned by AB-0012 (provision abadge_app + REVOKE); this trigger stands alone
-- and does not require that role to be in place.

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

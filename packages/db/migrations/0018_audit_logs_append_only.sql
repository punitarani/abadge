-- audit_logs is append-only: block row UPDATE/DELETE for every role so a bug,
-- compromised Worker, or insider cannot rewrite or erase audit evidence. The
-- trigger fires regardless of the connecting role, so it stands alone without
-- a least-privilege app role.
--
-- TRUNCATE is not a row-level op and bypasses this trigger (test cleanup relies
-- on that); revoking UPDATE/DELETE/TRUNCATE from a least-privilege app role is
-- the complementary defense-in-depth.

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

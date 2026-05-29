CREATE INDEX "agent_session_challenges_expires_at_idx" ON "agent_session_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "items_org_created_at_id_active_idx" ON "items" USING btree ("organization_id","created_at","id") WHERE "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_member_org_user" ON "member" USING btree ("organization_id","user_id");
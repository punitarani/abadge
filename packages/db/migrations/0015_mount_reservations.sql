CREATE TABLE "mount_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"mount_id" text NOT NULL,
	"item_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"delivery" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mount_reservations" ADD CONSTRAINT "mount_reservations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mount_reservations" ADD CONSTRAINT "mount_reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mount_reservations_mount_id_idx" ON "mount_reservations" USING btree ("mount_id");--> statement-breakpoint
CREATE INDEX "mount_reservations_item_id_idx" ON "mount_reservations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "mount_reservations_agent_id_idx" ON "mount_reservations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "mount_reservations_expires_at_idx" ON "mount_reservations" USING btree ("expires_at");
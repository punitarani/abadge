-- agent_groups table
CREATE TABLE IF NOT EXISTS "agent_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- agent_group_members table
CREATE TABLE IF NOT EXISTS "agent_group_members" (
	"group_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_group_members_pkey" PRIMARY KEY("group_id","agent_id")
);--> statement-breakpoint

-- foreign keys
ALTER TABLE "agent_groups" ADD CONSTRAINT "agent_groups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_members" ADD CONSTRAINT "agent_group_members_group_id_agent_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."agent_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_members" ADD CONSTRAINT "agent_group_members_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- indexes
CREATE INDEX IF NOT EXISTS "idx_agent_groups_user_id" ON "agent_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_group_members_agent_id" ON "agent_group_members" USING btree ("agent_id");

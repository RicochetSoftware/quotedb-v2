CREATE TABLE "auth_budgets" (
	"key" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_challenges_email_idx" ON "login_challenges" USING btree ("email");
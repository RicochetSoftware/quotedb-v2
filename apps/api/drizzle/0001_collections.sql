CREATE TABLE "collection_members" (
	"collection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_members_collection_id_user_id_pk" PRIMARY KEY("collection_id","user_id"),
	CONSTRAINT "collection_members_role_check" CHECK ("collection_members"."role" in ('owner', 'admin', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"personal_owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_personalOwnerId_unique" UNIQUE("personal_owner_id"),
	CONSTRAINT "collections_kind_check" CHECK (("collections"."kind" = 'personal' and "collections"."personal_owner_id" is not null) or ("collections"."kind" = 'shared' and "collections"."personal_owner_id" is null))
);
--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "quotes_user_created_idx";--> statement-breakpoint
ALTER TABLE "api_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "kind" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "issued_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discord_submitter_id" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discord_author_id" text;--> statement-breakpoint
-- Preserve quote IDs, dates, authors and API token secrets while changing the ownership boundary.
INSERT INTO collections (id, name, kind, personal_owner_id, created_at)
SELECT id, left(name || '''s quotes', 100), 'personal', id, created_at FROM users;
--> statement-breakpoint
INSERT INTO collection_members (collection_id, user_id, role)
SELECT id, id, 'owner' FROM users;
--> statement-breakpoint
UPDATE quotes SET collection_id = user_id;
--> statement-breakpoint
UPDATE api_tokens SET collection_id = user_id, issued_by_user_id = user_id;
--> statement-breakpoint
ALTER TABLE quotes ALTER COLUMN collection_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE api_tokens ALTER COLUMN collection_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_personal_owner_id_users_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_one_owner_idx" ON "collection_members" USING btree ("collection_id") WHERE "collection_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "collection_members_user_idx" ON "collection_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_collection_idx" ON "api_tokens" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "quotes_collection_created_idx" ON "quotes" USING btree ("collection_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "quotes"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_kind_check" CHECK ("api_tokens"."kind" in ('personal', 'collection'));
--> statement-breakpoint
-- User creation through the API, seed, importer, or administration always gets a personal collection.
CREATE FUNCTION create_personal_collection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO collections (id, name, kind, personal_owner_id) VALUES
    (NEW.id, left(NEW.name || '''s quotes', 100), 'personal', NEW.id);
  INSERT INTO collection_members (collection_id, user_id, role) VALUES (NEW.id, NEW.id, 'owner');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_personal_collection AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION create_personal_collection();

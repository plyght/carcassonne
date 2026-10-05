CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_cpu_usage" (
	"month" text PRIMARY KEY,
	"cpu_ms" bigint DEFAULT 0 NOT NULL,
	"moves" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"room_id" uuid,
	"engine_version" text NOT NULL,
	"seed" text NOT NULL,
	"ruleset" jsonb NOT NULL,
	"clock" jsonb DEFAULT '{"type":"none"}' NOT NULL,
	"players" integer NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	"queue" text,
	"status" text DEFAULT 'playing' NOT NULL,
	"ply" integer DEFAULT 0 NOT NULL,
	"turn_started_at" timestamp with time zone,
	"turn_deadline" timestamp with time zone,
	"final_scores" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_player" (
	"game_id" uuid,
	"seat" integer,
	"user_id" text,
	"guest_id" text,
	"name" text NOT NULL,
	"bot_tier" text,
	"color" text NOT NULL,
	"bank_ms" bigint,
	"consecutive_timeouts" integer DEFAULT 0 NOT NULL,
	"afk" boolean DEFAULT false NOT NULL,
	"final_score" integer,
	"placement" integer,
	"breakdown" jsonb,
	CONSTRAINT "game_player_pkey" PRIMARY KEY("game_id","seat")
);
--> statement-breakpoint
CREATE TABLE "instance_usage" (
	"instance_id" text PRIMARY KEY,
	"month" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"peak_sockets" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "move" (
	"game_id" uuid,
	"ply" integer,
	"seat" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"events" jsonb DEFAULT '[]' NOT NULL,
	"source" text DEFAULT 'player' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "move_pkey" PRIMARY KEY("game_id","ply")
);
--> statement-breakpoint
CREATE TABLE "presence" (
	"conn_id" text PRIMARY KEY,
	"game_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"user_id" text,
	"guest_id" text,
	"seat" integer,
	"name" text NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"avatar" text,
	"color_pref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"queue" text NOT NULL,
	"rating" double precision NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"game_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating" (
	"user_id" text,
	"queue" text,
	"mu" double precision DEFAULT 0 NOT NULL,
	"phi" double precision DEFAULT 2.014761872416068 NOT NULL,
	"sigma" double precision DEFAULT 0.06 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_pkey" PRIMARY KEY("user_id","queue")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"host_id" text NOT NULL,
	"ruleset" jsonb NOT NULL,
	"clock" jsonb DEFAULT '{"type":"none"}' NOT NULL,
	"max_players" integer DEFAULT 5 NOT NULL,
	"seats" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	"game_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "game_status_idx" ON "game" ("status");--> statement-breakpoint
CREATE INDEX "game_player_user_idx" ON "game_player" ("user_id");--> statement-breakpoint
CREATE INDEX "instance_usage_month_idx" ON "instance_usage" ("month");--> statement-breakpoint
CREATE INDEX "presence_game_idx" ON "presence" ("game_id","last_seen");--> statement-breakpoint
CREATE INDEX "queue_ticket_wait_idx" ON "queue_ticket" ("queue","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_ticket_one_waiting_uq" ON "queue_ticket" ("user_id") WHERE "status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "room_code_uq" ON "room" ("code");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_room_id_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "game_player" ADD CONSTRAINT "game_player_game_id_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "game_player" ADD CONSTRAINT "game_player_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "move" ADD CONSTRAINT "move_game_id_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queue_ticket" ADD CONSTRAINT "queue_ticket_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
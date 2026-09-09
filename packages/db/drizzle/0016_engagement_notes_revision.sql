PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_advisor_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_version` integer NOT NULL,
	`engagement_id` text NOT NULL,
	`status` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`uncertainty` text NOT NULL,
	`abstained` integer,
	`citations_json` text NOT NULL,
	`supplied_ids_json` text NOT NULL,
	`redactions` integer NOT NULL,
	`model_id` text NOT NULL,
	`error_code` text,
	`idempotency_key` text NOT NULL,
	`request_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "advisor_turn_contract_version" CHECK("__new_advisor_turns"."contract_version" = 1),
	CONSTRAINT "advisor_turn_status" CHECK("__new_advisor_turns"."status" in ('pending', 'succeeded', 'parse_error', 'provider_error', 'cancelled', 'expired')),
	CONSTRAINT "advisor_turn_question_bytes" CHECK(length(cast("__new_advisor_turns"."question" as blob)) between 1 and 2000),
	CONSTRAINT "advisor_turn_answer_bytes" CHECK(length(cast("__new_advisor_turns"."answer" as blob)) <= 8000),
	CONSTRAINT "advisor_turn_uncertainty_bytes" CHECK(length(cast("__new_advisor_turns"."uncertainty" as blob)) <= 2000),
	CONSTRAINT "advisor_turn_abstained" CHECK(("__new_advisor_turns"."status" = 'succeeded' and "__new_advisor_turns"."abstained" in (0, 1)) or ("__new_advisor_turns"."status" <> 'succeeded' and "__new_advisor_turns"."abstained" is null)),
	CONSTRAINT "advisor_turn_citations_json" CHECK(json_valid("__new_advisor_turns"."citations_json") and length(cast("__new_advisor_turns"."citations_json" as blob)) <= 8192),
	CONSTRAINT "advisor_turn_supplied_ids_json" CHECK(json_valid("__new_advisor_turns"."supplied_ids_json") and length(cast("__new_advisor_turns"."supplied_ids_json" as blob)) <= 8192),
	CONSTRAINT "advisor_turn_redactions" CHECK("__new_advisor_turns"."redactions" >= 0),
	CONSTRAINT "advisor_turn_model_id" CHECK(length("__new_advisor_turns"."model_id") between 1 and 128),
	CONSTRAINT "advisor_turn_error_code" CHECK("__new_advisor_turns"."error_code" is null or "__new_advisor_turns"."error_code" in ('provider_timeout', 'provider_unreachable', 'provider_response_too_large', 'provider_redirect_rejected', 'provider_parse_error', 'context_too_large')),
	CONSTRAINT "advisor_turn_idempotency_key" CHECK(length("__new_advisor_turns"."idempotency_key") between 22 and 128 and "__new_advisor_turns"."idempotency_key" not glob '*[^ -~]*'),
	CONSTRAINT "advisor_turn_request_digest" CHECK(length("__new_advisor_turns"."request_digest") = 71 and "__new_advisor_turns"."request_digest" glob 'sha256:[0-9a-f]*' and "__new_advisor_turns"."request_digest" not glob 'sha256:*[^0-9a-f]*'),
	CONSTRAINT "advisor_turn_created_at" CHECK(length("__new_advisor_turns"."created_at") >= 20),
	CONSTRAINT "advisor_turn_updated_at" CHECK(length("__new_advisor_turns"."updated_at") >= 20)
);
--> statement-breakpoint
INSERT INTO `__new_advisor_turns`("id", "contract_version", "engagement_id", "status", "question", "answer", "uncertainty", "abstained", "citations_json", "supplied_ids_json", "redactions", "model_id", "error_code", "idempotency_key", "request_digest", "created_at", "updated_at") SELECT "id", "contract_version", "engagement_id", "status", "question", "answer", "uncertainty", "abstained", "citations_json", "supplied_ids_json", "redactions", "model_id", "error_code", "idempotency_key", "request_digest", "created_at", "updated_at" FROM `advisor_turns`;--> statement-breakpoint
DROP TABLE `advisor_turns`;--> statement-breakpoint
ALTER TABLE `__new_advisor_turns` RENAME TO `advisor_turns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `advisor_turn_engagement_key_unique` ON `advisor_turns` (`engagement_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `advisor_turn_engagement_created_idx` ON `advisor_turns` (`engagement_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_engagement_notes` (
	`engagement_id` text PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "engagement_notes_markdown_bytes" CHECK(length(cast("__new_engagement_notes"."markdown" as blob)) <= 65536),
	CONSTRAINT "engagement_notes_updated_at" CHECK(length("__new_engagement_notes"."updated_at") >= 20),
	CONSTRAINT "engagement_notes_revision" CHECK("__new_engagement_notes"."revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_engagement_notes`("engagement_id", "markdown", "updated_at", "revision") SELECT "engagement_id", "markdown", "updated_at", 1 FROM `engagement_notes`;--> statement-breakpoint
DROP TABLE `engagement_notes`;--> statement-breakpoint
ALTER TABLE `__new_engagement_notes` RENAME TO `engagement_notes`;
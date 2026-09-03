CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_version` integer NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`evidence_artifact_ids_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "finding_contract_version" CHECK("findings"."contract_version" = 1),
	CONSTRAINT "finding_title_length" CHECK(length("findings"."title") between 1 and 120 and "findings"."title" = trim("findings"."title")),
	CONSTRAINT "finding_severity" CHECK("findings"."severity" in ('info', 'low', 'medium', 'high', 'critical')),
	CONSTRAINT "finding_status" CHECK("findings"."status" in ('open', 'resolved')),
	CONSTRAINT "finding_body_bytes" CHECK(length(cast("findings"."body" as blob)) <= 65536),
	CONSTRAINT "finding_evidence_json" CHECK(json_valid("findings"."evidence_artifact_ids_json") and length(cast("findings"."evidence_artifact_ids_json" as blob)) <= 8192),
	CONSTRAINT "finding_created_at" CHECK(length("findings"."created_at") >= 20),
	CONSTRAINT "finding_updated_at" CHECK(length("findings"."updated_at") >= 20)
);
--> statement-breakpoint
CREATE INDEX `finding_engagement_created_idx` ON `findings` (`engagement_id`,`created_at`,`id`);

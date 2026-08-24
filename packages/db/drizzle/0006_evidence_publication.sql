CREATE TABLE `evidence_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`contract_version` integer NOT NULL,
	`profile` text NOT NULL,
	`run_id` text NOT NULL,
	`fence` text NOT NULL,
	`event_sequence` integer NOT NULL,
	`artifact_slot` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`digest` text NOT NULL,
	`relative_path` text NOT NULL,
	`completeness` text NOT NULL,
	`redaction_applied` integer NOT NULL,
	`redaction_boundary` text NOT NULL,
	`raw_bytes_preserved` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_artifact_contract_version" CHECK("evidence_artifacts"."contract_version" = 1),
	CONSTRAINT "evidence_artifact_profile" CHECK("evidence_artifacts"."profile" = 'd3-v1'),
	CONSTRAINT "evidence_artifact_artifact_id" CHECK(length("evidence_artifacts"."artifact_id") between 1 and 127 and substr("evidence_artifacts"."artifact_id", 1, 1) glob '[a-z0-9]' and "evidence_artifacts"."artifact_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "evidence_artifact_run_id_length" CHECK(length("evidence_artifacts"."run_id") between 1 and 255),
	CONSTRAINT "evidence_artifact_fence_canonical_int64" CHECK(length("evidence_artifacts"."fence") between 1 and 19 and "evidence_artifacts"."fence" not glob '*[^0-9]*' and substr("evidence_artifacts"."fence", 1, 1) between '1' and '9' and (length("evidence_artifacts"."fence") < 19 or "evidence_artifacts"."fence" <= '9223372036854775807')),
	CONSTRAINT "evidence_artifact_event_sequence" CHECK("evidence_artifacts"."event_sequence" between 1 and 9007199254740991),
	CONSTRAINT "evidence_artifact_artifact_slot" CHECK(length("evidence_artifacts"."artifact_slot") between 1 and 127 and substr("evidence_artifacts"."artifact_slot", 1, 1) glob '[a-z0-9]' and "evidence_artifacts"."artifact_slot" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "evidence_artifact_kind" CHECK("evidence_artifacts"."kind" in ('stdout', 'stderr', 'tool_raw', 'tool_parsed_input')),
	CONSTRAINT "evidence_artifact_size_bytes" CHECK("evidence_artifacts"."size_bytes" between 0 and 1073741824),
	CONSTRAINT "evidence_artifact_digest" CHECK(length("evidence_artifacts"."digest") = 71 and "evidence_artifacts"."digest" glob 'sha256:[0-9a-f]*' and "evidence_artifacts"."digest" not glob 'sha256:*[^0-9a-f]*'),
	CONSTRAINT "evidence_artifact_relative_path" CHECK("evidence_artifacts"."relative_path" = 'published/' || "evidence_artifacts"."artifact_id"),
	CONSTRAINT "evidence_artifact_completeness" CHECK("evidence_artifacts"."completeness" in ('complete', 'partial', 'truncated')),
	CONSTRAINT "evidence_artifact_redaction_flags" CHECK("evidence_artifacts"."redaction_applied" in (0, 1) and "evidence_artifacts"."redaction_boundary" in ('runner_stream', 'none') and "evidence_artifacts"."raw_bytes_preserved" in (0, 1)),
	CONSTRAINT "evidence_artifact_redaction_tuple" CHECK((
        "evidence_artifacts"."kind" in ('stdout', 'stderr') and
        "evidence_artifacts"."redaction_applied" = 1 and
        "evidence_artifacts"."redaction_boundary" = 'runner_stream' and
        "evidence_artifacts"."raw_bytes_preserved" = 0
      ) or (
        "evidence_artifacts"."kind" in ('tool_raw', 'tool_parsed_input') and
        "evidence_artifacts"."redaction_applied" = 0 and
        "evidence_artifacts"."redaction_boundary" = 'none' and
        "evidence_artifacts"."raw_bytes_preserved" = 1
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_artifact_identity_unique` ON `evidence_artifacts` (`run_id`,`fence`,`event_sequence`,`artifact_slot`);--> statement-breakpoint
CREATE INDEX `evidence_artifact_run_created_idx` ON `evidence_artifacts` (`run_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evidence_grants` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`contract_version` integer NOT NULL,
	`profile` text NOT NULL,
	`upload_id` text NOT NULL,
	`run_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`runner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`fence` text NOT NULL,
	`event_sequence` integer NOT NULL,
	`artifact_slot` text NOT NULL,
	`kind` text NOT NULL,
	`declared_size_bytes` integer,
	`declared_digest` text,
	`original_file_name` text,
	`declared_content_type` text,
	`state` text NOT NULL,
	`reservation_bytes` integer NOT NULL,
	`put_finalized` integer NOT NULL,
	`accepted_bytes` integer NOT NULL,
	`streamed_digest` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_grant_contract_version" CHECK("__new_evidence_grants"."contract_version" = 1),
	CONSTRAINT "evidence_grant_profile" CHECK("__new_evidence_grants"."profile" = 'd3-v1'),
	CONSTRAINT "evidence_grant_artifact_id" CHECK(length("__new_evidence_grants"."artifact_id") between 1 and 127 and substr("__new_evidence_grants"."artifact_id", 1, 1) glob '[a-z0-9]' and "__new_evidence_grants"."artifact_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "evidence_grant_upload_id" CHECK(length("__new_evidence_grants"."upload_id") between 1 and 127 and substr("__new_evidence_grants"."upload_id", 1, 1) glob '[a-z0-9]' and "__new_evidence_grants"."upload_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "evidence_grant_artifact_slot" CHECK(length("__new_evidence_grants"."artifact_slot") between 1 and 127 and substr("__new_evidence_grants"."artifact_slot", 1, 1) glob '[a-z0-9]' and "__new_evidence_grants"."artifact_slot" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "evidence_grant_run_id_length" CHECK(length("__new_evidence_grants"."run_id") between 1 and 255),
	CONSTRAINT "evidence_grant_lease_id_length" CHECK(length("__new_evidence_grants"."lease_id") between 1 and 255),
	CONSTRAINT "evidence_grant_runner_id_length" CHECK(length("__new_evidence_grants"."runner_id") between 1 and 255),
	CONSTRAINT "evidence_grant_session_id_length" CHECK(length("__new_evidence_grants"."session_id") between 1 and 255),
	CONSTRAINT "evidence_grant_fence_canonical_int64" CHECK(length("__new_evidence_grants"."fence") between 1 and 19 and "__new_evidence_grants"."fence" not glob '*[^0-9]*' and substr("__new_evidence_grants"."fence", 1, 1) between '1' and '9' and (length("__new_evidence_grants"."fence") < 19 or "__new_evidence_grants"."fence" <= '9223372036854775807')),
	CONSTRAINT "evidence_grant_event_sequence" CHECK("__new_evidence_grants"."event_sequence" between 1 and 9007199254740991),
	CONSTRAINT "evidence_grant_kind" CHECK("__new_evidence_grants"."kind" in ('stdout', 'stderr', 'tool_raw', 'tool_parsed_input')),
	CONSTRAINT "evidence_grant_declared_size_bytes" CHECK("__new_evidence_grants"."declared_size_bytes" is null or "__new_evidence_grants"."declared_size_bytes" between 0 and 1073741824),
	CONSTRAINT "evidence_grant_declared_digest" CHECK("__new_evidence_grants"."declared_digest" is null or (length("__new_evidence_grants"."declared_digest") = 71 and "__new_evidence_grants"."declared_digest" glob 'sha256:[0-9a-f]*' and "__new_evidence_grants"."declared_digest" not glob 'sha256:*[^0-9a-f]*')),
	CONSTRAINT "evidence_grant_original_file_name" CHECK("__new_evidence_grants"."original_file_name" is null or length("__new_evidence_grants"."original_file_name") between 1 and 255),
	CONSTRAINT "evidence_grant_declared_content_type" CHECK("__new_evidence_grants"."declared_content_type" is null or length("__new_evidence_grants"."declared_content_type") between 1 and 127),
	CONSTRAINT "evidence_grant_state" CHECK("__new_evidence_grants"."state" in ('in_progress', 'upload_interrupted', 'published')),
	CONSTRAINT "evidence_grant_reservation_bytes" CHECK("__new_evidence_grants"."reservation_bytes" between 1 and 1073741824),
	CONSTRAINT "evidence_grant_put_finalized" CHECK("__new_evidence_grants"."put_finalized" in (0, 1)),
	CONSTRAINT "evidence_grant_accepted_bytes" CHECK("__new_evidence_grants"."accepted_bytes" between 0 and "__new_evidence_grants"."reservation_bytes"),
	CONSTRAINT "evidence_grant_streamed_digest" CHECK("__new_evidence_grants"."streamed_digest" is null or (length("__new_evidence_grants"."streamed_digest") = 71 and "__new_evidence_grants"."streamed_digest" glob 'sha256:[0-9a-f]*' and "__new_evidence_grants"."streamed_digest" not glob 'sha256:*[^0-9a-f]*'))
);
--> statement-breakpoint
INSERT INTO `__new_evidence_grants`("artifact_id", "contract_version", "profile", "upload_id", "run_id", "lease_id", "runner_id", "session_id", "fence", "event_sequence", "artifact_slot", "kind", "declared_size_bytes", "declared_digest", "original_file_name", "declared_content_type", "state", "reservation_bytes", "put_finalized", "accepted_bytes", "streamed_digest", "created_at", "updated_at") SELECT "artifact_id", "contract_version", "profile", "upload_id", "run_id", "lease_id", "runner_id", "session_id", "fence", "event_sequence", "artifact_slot", "kind", "declared_size_bytes", "declared_digest", "original_file_name", "declared_content_type", "state", "reservation_bytes", "put_finalized", "accepted_bytes", "streamed_digest", "created_at", "updated_at" FROM `evidence_grants`;--> statement-breakpoint
DROP TABLE `evidence_grants`;--> statement-breakpoint
ALTER TABLE `__new_evidence_grants` RENAME TO `evidence_grants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_grant_identity_in_progress_unique` ON `evidence_grants` (`run_id`,`fence`,`event_sequence`,`artifact_slot`) WHERE "evidence_grants"."state" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_grant_upload_id_unique` ON `evidence_grants` (`upload_id`);--> statement-breakpoint
CREATE INDEX `evidence_grant_runner_state_idx` ON `evidence_grants` (`runner_id`,`state`);--> statement-breakpoint
CREATE INDEX `evidence_grant_run_state_idx` ON `evidence_grants` (`run_id`,`state`);--> statement-breakpoint
CREATE INDEX `evidence_grant_run_fence_sequence_idx` ON `evidence_grants` (`run_id`,`fence`,`event_sequence`);
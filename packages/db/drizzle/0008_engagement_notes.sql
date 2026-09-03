CREATE TABLE `engagement_notes` (
	`engagement_id` text PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "engagement_notes_markdown_bytes" CHECK(length(cast("engagement_notes"."markdown" as blob)) <= 65536),
	CONSTRAINT "engagement_notes_updated_at" CHECK(length("engagement_notes"."updated_at") >= 20)
);

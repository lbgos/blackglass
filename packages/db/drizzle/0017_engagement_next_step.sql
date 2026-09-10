CREATE TABLE `engagement_next_steps` (
	`engagement_id` text PRIMARY KEY NOT NULL,
	`next_step` text,
	`updated_at` text NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "engagement_next_step_length" CHECK(`next_step` is null or length(`next_step`) between 1 and 280),
	CONSTRAINT "engagement_next_step_updated_at" CHECK(length(`updated_at`) >= 20),
	CONSTRAINT "engagement_next_step_revision" CHECK(`revision` >= 1)
);

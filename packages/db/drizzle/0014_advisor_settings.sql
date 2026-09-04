PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`scope` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_scope" CHECK("__new_settings"."scope" in ('runner', 'advisor')),
	CONSTRAINT "settings_value_json" CHECK(json_valid("__new_settings"."value_json") and length(cast("__new_settings"."value_json" as blob)) <= 65536),
	CONSTRAINT "settings_updated_at" CHECK(length("__new_settings"."updated_at") >= 20)
);
--> statement-breakpoint
INSERT INTO `__new_settings`("scope", "value_json", "updated_at") SELECT "scope", "value_json", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
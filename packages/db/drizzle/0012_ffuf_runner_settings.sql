CREATE TABLE `settings` (
	`scope` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_scope" CHECK("settings"."scope" = 'runner'),
	CONSTRAINT "settings_value_json" CHECK(json_valid("settings"."value_json") and length(cast("settings"."value_json" as blob)) <= 65536),
	CONSTRAINT "settings_updated_at" CHECK(length("settings"."updated_at") >= 20)
);

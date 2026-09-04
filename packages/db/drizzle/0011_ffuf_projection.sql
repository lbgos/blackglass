CREATE TABLE `ffuf_results` (
	`artifact_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`url` text NOT NULL,
	`status` integer NOT NULL,
	`length` integer NOT NULL,
	`words` integer NOT NULL,
	`lines` integer NOT NULL,
	`redirectlocation` text,
	`fuzz` text NOT NULL,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `parser_version`, `url`),
	FOREIGN KEY (`artifact_id`) REFERENCES `evidence_artifacts`(`artifact_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ffuf_result_artifact_id" CHECK(length("ffuf_results"."artifact_id") between 1 and 127
        and substr("ffuf_results"."artifact_id",1,1) glob '[a-z0-9]'
        and "ffuf_results"."artifact_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ffuf_result_parser_version" CHECK(length("ffuf_results"."parser_version") between 1 and 64
        and "ffuf_results"."parser_version" not glob '*[^a-z0-9._-]*'
        and substr("ffuf_results"."parser_version", 1, 1) glob '[a-z0-9]'),
	CONSTRAINT "ffuf_result_url" CHECK(length("ffuf_results"."url") between 1 and 2048),
	CONSTRAINT "ffuf_result_status" CHECK("ffuf_results"."status" between 100 and 599),
	CONSTRAINT "ffuf_result_counts" CHECK("ffuf_results"."length" >= 0 and "ffuf_results"."words" >= 0 and "ffuf_results"."lines" >= 0),
	CONSTRAINT "ffuf_result_redirect" CHECK("ffuf_results"."redirectlocation" is null or length("ffuf_results"."redirectlocation") between 1 and 2048),
	CONSTRAINT "ffuf_result_fuzz" CHECK(length("ffuf_results"."fuzz") between 1 and 2048),
	CONSTRAINT "ffuf_result_observed_at" CHECK(length("ffuf_results"."observed_at") >= 20)
);

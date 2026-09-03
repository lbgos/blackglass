CREATE TABLE `http_probe_results` (
	`artifact_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`url` text NOT NULL,
	`final_url` text NOT NULL,
	`status` integer,
	`title` text,
	`content_type` text,
	`server` text,
	`powered_by` text,
	`hops_json` text NOT NULL,
	`probe_error` text,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `parser_version`, `url`),
	FOREIGN KEY (`artifact_id`) REFERENCES `evidence_artifacts`(`artifact_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "http_probe_result_artifact_id" CHECK(length("http_probe_results"."artifact_id") between 1 and 127
        and substr("http_probe_results"."artifact_id",1,1) glob '[a-z0-9]'
        and "http_probe_results"."artifact_id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "http_probe_result_parser_version" CHECK(length("http_probe_results"."parser_version") between 1 and 64
        and "http_probe_results"."parser_version" not glob '*[^a-z0-9._-]*'
        and substr("http_probe_results"."parser_version", 1, 1) glob '[a-z0-9]'),
	CONSTRAINT "http_probe_result_url" CHECK(length("http_probe_results"."url") between 1 and 2048),
	CONSTRAINT "http_probe_result_final_url" CHECK(length("http_probe_results"."final_url") between 1 and 2048),
	CONSTRAINT "http_probe_result_status" CHECK("http_probe_results"."status" is null or ("http_probe_results"."status" between 100 and 599)),
	CONSTRAINT "http_probe_result_title" CHECK("http_probe_results"."title" is null or length("http_probe_results"."title") between 1 and 256),
	CONSTRAINT "http_probe_result_hops_json" CHECK(json_valid("http_probe_results"."hops_json") and length(cast("http_probe_results"."hops_json" as blob)) <= 65536),
	CONSTRAINT "http_probe_result_observed_at" CHECK(length("http_probe_results"."observed_at") >= 20)
);

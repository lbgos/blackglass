# Guided demo lab

One command starts an isolated stack plus a benign loopback fixture, runs real Nmap, HTTP probe, and ffuf against only the fixture port, then records a finding, notes, and an exported report.

```bash
pnpm install --frozen-lockfile
pnpm --filter @blackglass/evidence-native build
pnpm demo
```

Open the printed UI URL. Keep the app alive until Ctrl+C; only processes started by the demo are cleaned up.

Defaults: API `127.0.0.1:3286`, web `127.0.0.1:5286`, fixture `127.0.0.1:43860`, fresh data dir under `.blackglass/demo-<timestamp>`. Daily-driver ports `3001`/`5173` and storage `.blackglass/dev` are refused. Flags: `--smoke` proves the pipeline then stops with a truthful exit code, `--reset` wipes only a demo-owned data directory, `--api-port`, `--web-port`, `--fixture-port`, `--data-dir` (absolute path).

Runner credentials stay in memory; no secret is printed and no credential file is written. Everything scanned is loopback; the fixture serves two static demo pages and the wordlist has four entries. Notes use the revision path when the API provides it and fail rather than overwrite on conflict. Advisor setup stays manual and is not claimed by this demo.

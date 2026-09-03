# Blackglass

A local-first workbench for CTFs and lab work.

When I work a box, tool output lives in terminal tabs, notes in one file, screenshots in another folder, and nothing ties them together. Blackglass puts all of it under the engagement: targets, scope, tool runs, raw output, findings. It runs on your machine, keeps everything in a local SQLite file, and works offline.

## What it does

**Engagements.** One per box, lab, or assessment. Targets, scope, runs, and findings live under it instead of scattered across folders.

**Scope.** Saved rules define what is in bounds. Point a tool at something out of scope and you get one concise warning. Continue runs it and records the warning with the exact target, so nothing gets blocked silently and nothing gets forgotten.

**Runner.** Tools run as child processes on your host. Spawned by argv, never shell strings, cancelled with the whole process group, resource-limited. Runs hold leases with fencing tokens, so a stale runner cannot append results after it lost the lease.

**Evidence.** Raw tool output is stored immutable and content-addressed before anything reads or formats it. You can always go back to what the tool actually said.

**Findings.** Next slice, not built yet: turn a run into a finding with your own notes attached.

**Advisor.** Deferred until the advisor gate (D6): point it at any OpenAI-compatible endpoint, local by default, and the model reads your evidence and suggests what to look at next. Optional.

## Status

In active development. The program goal is a workbench that can operate a real CTF box end to end.

Working today: engagements with archive and reopen, targets with saved scope and one-click continue, and the Nmap loop with lifecycle polling, XML evidence publication, and projected services with evidence download links.

Honest placeholders: the console Advisor, Activity, and Raw output tabs are deferred surfaces, settings controls show shipped defaults until the settings store lands, and plugins wait on the D5 protocol gate. The next slices in order are engagement notes, HTTP probing, findings capture, raw run output viewing, and engagement deadlines. The full plan lives in [docs/development/V0.1_PLAN.md](./docs/development/V0.1_PLAN.md).

## Quick start

Requires Node.js 24 and pnpm 10.

```bash
pnpm install
pnpm dev        # supervised API + web with isolated dev storage
pnpm check      # format, lint, typecheck, test, build
```

## Stack

- Node.js 24, pnpm workspaces, strict TypeScript
- React 19, Vite, TanStack Router and Query, Tailwind CSS v4
- Fastify, Zod, REST, Server-Sent Events
- SQLite in WAL mode through Drizzle
- plugin protocol over versioned NDJSON is planned and gated on D5; no plugin SDK ships yet

## Layout

```text
apps/web            React client
apps/api            Fastify control plane
apps/runner         native host runner
packages/contracts  shared Zod, API, and event contracts
packages/domain     pure rules and state transitions
packages/db         Drizzle schema and migrations
packages/ui         Blackglass-owned UI primitives
docs/               plans, contracts, and status
```

## Docs

- [AGENTS.md](./AGENTS.md): rules for coding agents in this repository
- [docs/development/V0.1_PLAN.md](./docs/development/V0.1_PLAN.md): product plan and milestones
- [docs/architecture/DECISION_GATES.md](./docs/architecture/DECISION_GATES.md): decisions that must settle before their milestone
- [docs/ui/constitution.md](./docs/ui/constitution.md): shell, motion, theme, and accessibility behavior

## License

[AGPL-3.0](./LICENSE)

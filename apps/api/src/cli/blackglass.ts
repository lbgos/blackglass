#!/usr/bin/env node
import { runBlackglassCli } from "./blackglass-cli.js";

const exitCode = await runBlackglassCli(process.argv.slice(2), process.env);
process.exitCode = exitCode;

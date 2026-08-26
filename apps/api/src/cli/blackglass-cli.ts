import { dataDirectoryFromEnvironment } from "../config.js";
import { runEvidenceDoctor } from "../evidence/doctor.js";

// Minimal dependency-free CLI entry for `blackglass doctor`. The only
// output channel is deterministic JSON on stdout; exit code 0 means a
// healthy report, 1 means defects or an error outcome, 2 is usage or
// configuration failure. No physical path ever appears in stdout output.

export interface BlackglassCliIo {
  readonly writeOut: (line: string) => void;
  readonly writeError: (line: string) => void;
}

const defaultIo: BlackglassCliIo = {
  writeOut: (line) => process.stdout.write(line),
  writeError: (line) => process.stderr.write(line),
};

const USAGE = "usage: blackglass doctor (requires BLACKGLASS_DATA_DIR)";

export async function runBlackglassCli(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  io: BlackglassCliIo = defaultIo,
): Promise<number> {
  if (argv.length !== 1 || argv[0] !== "doctor") {
    io.writeError(`${USAGE}\n`);
    return 2;
  }

  let dataDirectory: string;
  try {
    dataDirectory = dataDirectoryFromEnvironment(environment);
  } catch (error) {
    io.writeError(`${error instanceof Error ? error.message : USAGE}\n`);
    return 2;
  }

  const outcome = await runEvidenceDoctor({ dataDirectory });
  const payload =
    outcome.status === "report"
      ? { status: "report", report: outcome.report }
      : { status: "error", code: outcome.code };
  io.writeOut(`${JSON.stringify(payload)}\n`);
  return outcome.status === "report" && outcome.report.healthy ? 0 : 1;
}

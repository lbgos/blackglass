import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compiles the single-file N-API addon with the host C compiler and the Node
// headers shipped with the runtime. Owner-approved build requirement (D3
// publication slice): Linux, glibc >= 2.28 for renameat2. Non-Linux hosts
// skip compilation; the loader then reports unsupported and every evidence
// route fails closed instead of serving.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(packageRoot, "build");
const outputPath = path.join(outputDirectory, "evidence_native.node");
const sourcePath = path.join(packageRoot, "src", "evidence_native.c");

function nodeIncludeDirectories() {
  const directories = [];
  const execPrefix = path.dirname(process.execPath);
  directories.push(path.join(execPrefix, "..", "include", "node"));
  directories.push("/usr/include/node");
  directories.push("/usr/local/include/node");
  return [...new Set(directories)].filter((candidate) =>
    existsSync(path.join(candidate, "node_api.h")),
  );
}

if (os.platform() !== "linux") {
  console.log("evidence-native: non-linux host, skipping addon build (fail-closed at runtime).");
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error("evidence-native: missing C source.");
  process.exit(1);
}

const includes = nodeIncludeDirectories();
if (includes.length === 0) {
  console.error("evidence-native: node_api.h not found; install Node development headers.");
  process.exit(1);
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const args = [
  "-O2",
  "-fPIC",
  "-shared",
  "-std=c11",
  "-DNAPI_VERSION=8",
  "-Wall",
  "-Werror",
  ...includes.flatMap((directory) => ["-I", directory]),
  "-o",
  outputPath,
  sourcePath,
];

const result = spawnSync("cc", args, { stdio: "inherit", shell: false });
if (result.error || result.status !== 0) {
  console.error("evidence-native: C compiler failed.");
  process.exit(result.status ?? 1);
}
console.log(`evidence-native: built ${path.relative(packageRoot, outputPath)}`);

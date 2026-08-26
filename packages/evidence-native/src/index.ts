import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Typed loader for the descriptor-relative filesystem boundary. The binding
// exposes only openat(2), renameat2(RENAME_NOREPLACE), and a read-only
// directory-fd enumeration (dup + fdopendir/readdir); every failure is
// returned as errno data so policy stays in TypeScript.

// Node's fs.constants does not export O_CLOEXEC (libuv sets it implicitly
// for its own opens), but our openat calls pass raw flags to the kernel.
export const O_CLOEXEC = 0x80000;

export interface NativeOpenResult {
  readonly ok: true;
  readonly fd: number;
}

export interface NativeErrnoResult<TOk extends boolean = boolean> {
  readonly ok: TOk;
  readonly errno: number;
}

export type NativeOpenOutcome = NativeOpenResult | { readonly ok: false; readonly errno: number };

export interface NativeReadDirResult {
  readonly ok: true;
  // Snapshot of the directory entries at enumeration time, excluding "." and
  // "..". Names are untrusted: callers must openat(O_NOFOLLOW) and fstat each
  // one before use.
  readonly names: readonly string[];
}

export interface EvidenceNativeBinding {
  openAt(dirfd: number, name: string, flags: number, mode: number): NativeOpenOutcome;
  renameNoReplace(
    oldDirfd: number,
    oldName: string,
    newDirfd: number,
    newName: string,
  ): { readonly ok: true } | { readonly ok: false; readonly errno: number };
  readDirNames(dirfd: number): NativeReadDirResult | { readonly ok: false; readonly errno: number };
}

export type EvidenceNativeLoadResult =
  | { ok: true; binding: EvidenceNativeBinding }
  | { ok: false; reason: EvidenceNativeUnavailableReason };

export type EvidenceNativeUnavailableReason =
  | "unsupported_platform"
  | "native_binding_unavailable";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export function loadEvidenceNative(
  bindingPath = path.join(packageRoot, "..", "build", "evidence_native.node"),
): EvidenceNativeLoadResult {
  if (process.platform !== "linux") {
    return { ok: false, reason: "unsupported_platform" };
  }
  const require = createRequire(import.meta.url);
  let loaded: Record<string, unknown>;
  try {
    loaded = require(bindingPath) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "native_binding_unavailable" };
  }
  const { openAt, renameNoReplace, readDirNames } = loaded as Partial<EvidenceNativeBinding>;
  if (
    typeof openAt !== "function" ||
    typeof renameNoReplace !== "function" ||
    typeof readDirNames !== "function"
  ) {
    return { ok: false, reason: "native_binding_unavailable" };
  }
  return {
    ok: true,
    binding: {
      openAt: (dirfd, name, flags, mode) => openAt(dirfd, name, flags, mode),
      renameNoReplace: (oldDirfd, oldName, newDirfd, newName) =>
        renameNoReplace(oldDirfd, oldName, newDirfd, newName),
      readDirNames: (dirfd) => readDirNames(dirfd),
    },
  };
}

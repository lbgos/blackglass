import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
} from "node:fs";
import path from "node:path";

import { O_CLOEXEC, type EvidenceNativeBinding } from "@blackglass/evidence-native";

// ADR-0003 backup quiesce gate: one advisory flock lockfile under the
// control-owned data root. Grant admission and complete hold nonblocking
// shared locks; a backup snapshot holds the exclusive lock for its whole
// duration. The lock lives in the kernel, so a crashed holder never wedges
// publication. Every acquisition opens its own file description so
// overlapping shared holders inside one process cannot release each other.

const LOCK_FILENAME = "backup.lock";

const LOCKFILE_OPEN_FLAGS =
  fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | O_CLOEXEC;

export const BACKUP_LOCK_FILENAME = LOCK_FILENAME;

export type BackupLockErrorCode = "storage_backup_quiesced" | "evidence_io_error";

export interface BackupLockAcquisition {
  ok: true;
  release: () => void;
}

export type BackupLockAttempt =
  | BackupLockAcquisition
  | { ok: false; code: BackupLockErrorCode };

// Narrow surface consumed by the grant route and the publication service.
// Callers cannot see the lockfile descriptor, only typed acquisitions.
export interface StorageQuiesceGate {
  acquireShared(): BackupLockAttempt;
}

export type BackupLockOpenResult =
  | { ok: true; lock: BackupLock }
  | { ok: false; code: "evidence_storage_invalid" };

const ERRNO = {
  EWOULDBLOCK: 11,
  EACCES: 13,
} as const;

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Best-effort close; nothing actionable remains.
  }
}

export class BackupLock implements StorageQuiesceGate {
  private constructor(
    private readonly binding: EvidenceNativeBinding,
    // Held for the lifetime of the lock object so an attacker cannot unlink
    // and swap the lockfile between acquisitions.
    private readonly anchorFd: number,
    private readonly lockFilePath: string,
  ) {}

  static open(
    dataDirectory: string,
    binding: EvidenceNativeBinding,
    getCurrentUid: () => number | undefined = () =>
      typeof process.getuid === "function" ? process.getuid() : undefined,
  ): BackupLockOpenResult {
    const uid = getCurrentUid();
    if (uid === undefined) return { ok: false, code: "evidence_storage_invalid" };
    const lockFilePath = path.join(dataDirectory, LOCK_FILENAME);

    let anchorFd: number;
    try {
      anchorFd = openSync(
        lockFilePath,
        LOCKFILE_OPEN_FLAGS | fsConstants.O_CREAT | fsConstants.O_EXCL,
        0o600,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") {
        return { ok: false, code: "evidence_storage_invalid" };
      }
      try {
        anchorFd = openSync(lockFilePath, LOCKFILE_OPEN_FLAGS);
      } catch {
        return { ok: false, code: "evidence_storage_invalid" };
      }
    }
    try {
      const stats = fstatSync(anchorFd);
      if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid) {
        throw new Error("lockfile identity rejected");
      }
    } catch {
      closeQuietly(anchorFd);
      return { ok: false, code: "evidence_storage_invalid" };
    }
    return { ok: true, lock: new BackupLock(binding, anchorFd, lockFilePath) };
  }

  acquireShared(): BackupLockAttempt {
    return this.acquire("shared");
  }

  acquireExclusive(): BackupLockAttempt {
    return this.acquire("exclusive");
  }

  private acquire(mode: "shared" | "exclusive"): BackupLockAttempt {
    let fd: number;
    try {
      fd = openSync(this.lockFilePath, LOCKFILE_OPEN_FLAGS);
    } catch {
      return { ok: false, code: "evidence_io_error" };
    }
    try {
      // Each acquisition owns a fresh open file description, so this flock
      // participates independently in cross-process arbitration.
      const outcome = this.binding.flockNonblock(fd, mode);
      if (!outcome.ok) {
        closeQuietly(fd);
        if (
          outcome.errno === ERRNO.EWOULDBLOCK ||
          outcome.errno === ERRNO.EACCES
        ) {
          return { ok: false, code: "storage_backup_quiesced" };
        }
        return { ok: false, code: "evidence_io_error" };
      }
    } catch {
      closeQuietly(fd);
      return { ok: false, code: "evidence_io_error" };
    }
    return {
      ok: true,
      release: () => {
        try {
          this.binding.flockNonblock(fd, "release");
        } finally {
          closeQuietly(fd);
        }
      },
    };
  }

  close(): void {
    closeQuietly(this.anchorFd);
  }
}

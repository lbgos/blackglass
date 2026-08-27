import { chmod, mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { closeSync, constants, fstatSync, openSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEvidenceNative, O_CLOEXEC } from "@blackglass/evidence-native";
import { afterEach, describe, expect, it } from "vitest";

import { BackupLock } from "./backup-lock.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("BackupLock anchored validation", () => {
  it("refuses to lock a replacement file after unlink+replace, keeps original anchor open", async () => {
    const native = loadEvidenceNative();
    if (!native.ok) throw new Error(`native unavailable: ${native.reason}`);
    const directory = await mkdtemp(path.join(tmpdir(), "backup-lock-anchor-"));
    await chmod(directory, 0o700);
    directories.push(directory);

    // Establish the anchored lockfile.
    const opened = BackupLock.open(directory, native.binding);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const lock = opened.lock;

    const lockPath = path.join(directory, "backup.lock");
    // Capture anchored inode for sanity check.
    const anchorStatsBefore = fstatSync((lock as unknown as { anchorFd: number }).anchorFd as number);
    // Atomically replace the pathname with a new inode (same name, same mode).
    await unlink(lockPath);
    await writeFile(lockPath, "replacement-lock-bytes");
    await chmod(lockPath, 0o600);
    // Also chmod to ensure mode passes other checks; the replacement is a
    // regular file with nlink 1 and correct mode but different inode.
    const replacementFd = openSync(lockPath, constants.O_RDONLY | O_CLOEXEC);
    const replacementStats = fstatSync(replacementFd);
    closeSync(replacementFd);
    // dev may be same, ino must differ.
    expect(replacementStats.ino).not.toBe(anchorStatsBefore.ino);

    // Every acquisition must fstat the pathname and compare dev+ino to the
    // anchored identity. A mismatch must be refused before flock, not flock
    // the replacement.
    const shared = lock.acquireShared();
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.code).toBe("evidence_io_error");

    const exclusive = lock.acquireExclusive();
    expect(exclusive.ok).toBe(false);
    if (!exclusive.ok) expect(exclusive.code).toBe("evidence_io_error");

    // The original anchor fd remains fstat-able with same dev/ino but now has nlink 0 (unlinked).
    const anchorStatsAfter = fstatSync((lock as unknown as { anchorFd: number }).anchorFd as number);
    expect(anchorStatsAfter.dev).toBe(anchorStatsBefore.dev);
    expect(anchorStatsAfter.ino).toBe(anchorStatsBefore.ino);
    expect(anchorStatsAfter.nlink).toBe(0);

    lock.close();

    // After closing the anchor, a new BackupLock.open on the same directory
    // should now anchor the replacement file successfully (different inode).
    const reopened = BackupLock.open(directory, native.binding);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) reopened.lock.close();
  });

  it("validates current uid, regular file, nlink 1, and mode 0600 before locking", async () => {
    const native = loadEvidenceNative();
    if (!native.ok) throw new Error(`native unavailable: ${native.reason}`);
    const directory = await mkdtemp(path.join(tmpdir(), "backup-lock-mode-"));
    await chmod(directory, 0o700);
    directories.push(directory);

    const opened = BackupLock.open(directory, native.binding);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const lock = opened.lock;
    const lockPath = path.join(directory, "backup.lock");

    // Corrupt mode: chmod to 0644 should cause next acquire to be rejected.
    await chmod(lockPath, 0o644);
    let attempt = lock.acquireShared();
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.code).toBe("evidence_io_error");

    await chmod(lockPath, 0o600);
    // Corrupt nlink: hardlink the lockfile so nlink becomes 2.
    const hardlinkPath = path.join(directory, "backup.hardlink");
    // Use a hardlink via fs.link
    const { link } = await import("node:fs/promises");
    await link(lockPath, hardlinkPath);
    attempt = lock.acquireExclusive();
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.code).toBe("evidence_io_error");
    await unlink(hardlinkPath);

    // After fixing, acquisition should succeed again.
    attempt = lock.acquireShared();
    expect(attempt.ok).toBe(true);
    if (attempt.ok) attempt.release();

    lock.close();
  });
});

describe("BackupLock release idempotency", () => {
  it("release is idempotent and does not touch a recycled fd", async () => {
    const native = loadEvidenceNative();
    if (!native.ok) throw new Error(`native unavailable: ${native.reason}`);
    const directory = await mkdtemp(path.join(tmpdir(), "backup-lock-idempotent-"));
    await chmod(directory, 0o700);
    directories.push(directory);

    const opened = BackupLock.open(directory, native.binding);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const lock = opened.lock;

    const acquired = lock.acquireExclusive();
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      lock.close();
      return;
    }

    // First release closes the acquisition fd.
    acquired.release();

    // Open a dummy file that will likely reuse the just-closed fd number.
    const dummyPath = path.join(directory, "dummy-recycled");
    await writeFile(dummyPath, "dummy");
    const dummyFd = openSync(dummyPath, constants.O_RDONLY | O_CLOEXEC);
    const dummyStatsBefore = fstatSync(dummyFd);

    // Second release must be a no-op and must not close the recycled fd.
    expect(() => acquired.release()).not.toThrow();
    expect(() => acquired.release()).not.toThrow();

    // The dummy fd must still be valid.
    const dummyStatsAfter = fstatSync(dummyFd);
    expect(dummyStatsAfter.dev).toBe(dummyStatsBefore.dev);
    expect(dummyStatsAfter.ino).toBe(dummyStatsBefore.ino);
    closeSync(dummyFd);

    // After release, a new exclusive acquisition should succeed (lock was
    // truly released once).
    const second = lock.acquireExclusive();
    expect(second.ok).toBe(true);
    if (second.ok) second.release();

    // Double release on the second acquisition also stays idempotent.
    if (second.ok) {
      expect(() => second.release()).not.toThrow();
      expect(() => second.release()).not.toThrow();
    }

    lock.close();
  });
});

describe("BackupLock close idempotency and post-close fail-closed", () => {
  it("double close is idempotent and does not close a recycled fd", async () => {
    const native = loadEvidenceNative();
    if (!native.ok) throw new Error(`native unavailable: ${native.reason}`);
    const directory = await mkdtemp(path.join(tmpdir(), "backup-lock-double-close-"));
    await chmod(directory, 0o700);
    directories.push(directory);

    const opened = BackupLock.open(directory, native.binding);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const lock = opened.lock;

    // First close succeeds.
    lock.close();
    // Second close must be a no-op and not throw.
    expect(() => lock.close()).not.toThrow();
    expect(() => lock.close()).not.toThrow();

    // Open a dummy file that will likely reuse the just-closed anchor fd number.
    const dummyPath = path.join(directory, "dummy-recycled-close");
    await writeFile(dummyPath, "dummy");
    const dummyFd = openSync(dummyPath, constants.O_RDONLY | O_CLOEXEC);
    const dummyStatsBefore = fstatSync(dummyFd);

    // Additional closes after the fd has been recycled must not close the dummy.
    expect(() => lock.close()).not.toThrow();
    expect(() => lock.close()).not.toThrow();

    const dummyStatsAfter = fstatSync(dummyFd);
    expect(dummyStatsAfter.dev).toBe(dummyStatsBefore.dev);
    expect(dummyStatsAfter.ino).toBe(dummyStatsBefore.ino);
    closeSync(dummyFd);

    // Still safe to close again.
    expect(() => lock.close()).not.toThrow();
  });

  it("acquireShared and acquireExclusive after close fail closed without opening or touching any descriptor", async () => {
    const native = loadEvidenceNative();
    if (!native.ok) throw new Error(`native unavailable: ${native.reason}`);
    const directory = await mkdtemp(path.join(tmpdir(), "backup-lock-post-close-"));
    await chmod(directory, 0o700);
    directories.push(directory);

    // Track flock calls to prove post-close acquisitions never reach the native binding.
    let flockCalls = 0;
    const trackingBinding = {
      flockNonblock: (...args: Parameters<typeof native.binding.flockNonblock>) => {
        flockCalls += 1;
        return native.binding.flockNonblock(...args);
      },
    };

    const opened = BackupLock.open(directory, trackingBinding as unknown as typeof native.binding);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const lock = opened.lock;

    lock.close();

    const countFds = (): number => {
      try {
        return readdirSync("/proc/self/fd").length;
      } catch {
        // Fallback when /proc is unavailable; prove via flockCalls and dummy fd instead.
        return -1;
      }
    };

    // Both acquisition modes must fail closed after close.
    flockCalls = 0;
    const fdsBeforeShared = countFds();
    const shared = lock.acquireShared();
    const fdsAfterShared = countFds();
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.code).toBe("evidence_io_error");
    expect(flockCalls).toBe(0);
    if (fdsBeforeShared !== -1) expect(fdsAfterShared).toBe(fdsBeforeShared);

    flockCalls = 0;
    const fdsBeforeExclusive = countFds();
    const exclusive = lock.acquireExclusive();
    const fdsAfterExclusive = countFds();
    expect(exclusive.ok).toBe(false);
    if (!exclusive.ok) expect(exclusive.code).toBe("evidence_io_error");
    expect(flockCalls).toBe(0);
    if (fdsBeforeExclusive !== -1) expect(fdsAfterExclusive).toBe(fdsBeforeExclusive);

    // Prove acquisitions do not touch a recycled descriptor: occupy the recycled anchor fd.
    const dummyPath = path.join(directory, "dummy-recycled-post-close");
    await writeFile(dummyPath, "dummy");
    const dummyFd = openSync(dummyPath, constants.O_RDONLY | O_CLOEXEC);
    const dummyStatsBefore = fstatSync(dummyFd);

    flockCalls = 0;
    const fdsBeforeRecycled = countFds();
    const shared2 = lock.acquireShared();
    const exclusive2 = lock.acquireExclusive();
    const fdsAfterRecycled = countFds();
    expect(shared2.ok).toBe(false);
    if (!shared2.ok) expect(shared2.code).toBe("evidence_io_error");
    expect(exclusive2.ok).toBe(false);
    if (!exclusive2.ok) expect(exclusive2.code).toBe("evidence_io_error");
    expect(flockCalls).toBe(0);
    if (fdsBeforeRecycled !== -1) expect(fdsAfterRecycled).toBe(fdsBeforeRecycled);

    // The dummy fd that reused the anchor number must still be valid.
    const dummyStatsAfter = fstatSync(dummyFd);
    expect(dummyStatsAfter.dev).toBe(dummyStatsBefore.dev);
    expect(dummyStatsAfter.ino).toBe(dummyStatsBefore.ino);
    closeSync(dummyFd);

    // Repeated post-close acquisitions remain fail-closed and close stays idempotent.
    expect(lock.acquireShared().ok).toBe(false);
    expect(lock.acquireExclusive().ok).toBe(false);
    expect(() => lock.close()).not.toThrow();
    expect(() => lock.close()).not.toThrow();
  });
});

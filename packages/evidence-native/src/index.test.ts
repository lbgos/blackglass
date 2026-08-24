import { constants } from "node:fs";
import { mkdtemp, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEvidenceNative, O_CLOEXEC } from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await import("node:fs/promises").then((fs) =>
        fs.rm(directory, { recursive: true, force: true }),
      );
    }),
  );
});

const supported = loadEvidenceNative();

describe("evidence native binding", () => {
  it("loads on supported hosts", () => {
    if (!supported.ok && process.platform === "linux") {
      throw new Error(`native binding unavailable: ${supported.reason}`);
    }
    expect(supported.ok || process.platform !== "linux").toBe(true);
  });

  it.runIf(process.platform === "linux")("creates exclusive files relative to a directory descriptor", async () => {
    if (!supported.ok) return;
    const directory = await mkdtemp(path.join(tmpdir(), "evidence-native-"));
    directories.push(directory);
    const { open, stat } = await import("node:fs/promises");
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    try {
      const created = supported.binding.openAt(
        handle.fd,
        "upload-a",
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | O_CLOEXEC,
        0o600,
      );
      expect(created).toEqual({ ok: true, fd: expect.any(Number) });
      if (!created.ok) return;
      const stats = await stat(path.join(directory, "upload-a"));
      expect(stats.mode & 0o777).toBe(0o600);
      const second = supported.binding.openAt(
        handle.fd,
        "upload-a",
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      expect(second).toEqual({ ok: false, errno: /* EEXIST */ 17 });
      await unlink(path.join(directory, "upload-a"));
    } finally {
      await handle.close();
    }
  });

  it.runIf(process.platform === "linux")("refuses separator-bearing segments without calling the kernel", async () => {
    if (!supported.ok) return;
    const directory = await mkdtemp(path.join(tmpdir(), "evidence-native-"));
    directories.push(directory);
    const { open } = await import("node:fs/promises");
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    try {
      // Separator-bearing or relative-parent segments never reach the kernel:
      // the binding throws a programmer-error TypeError instead.
      expect(() => supported.binding.openAt(handle.fd, "a/b", constants.O_RDONLY, 0)).toThrow(TypeError);
      expect(() => supported.binding.openAt(handle.fd, "..", constants.O_RDONLY, 0)).toThrow(TypeError);
      expect(() =>
        supported.binding.renameNoReplace(handle.fd, "a", handle.fd, "../escape"),
      ).toThrow(TypeError);
    } finally {
      await handle.close();
    }
  });

  it.runIf(process.platform === "linux")("renames with no-replace semantics", async () => {
    if (!supported.ok) return;
    const directory = await mkdtemp(path.join(tmpdir(), "evidence-native-"));
    directories.push(directory);
    await mkdir(path.join(directory, "published"));
    const { open } = await import("node:fs/promises");
    const stagingHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    const publishedHandle = await open(
      path.join(directory, "published"),
      constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC,
    );
    try {
      const created = supported.binding.openAt(
        stagingHandle.fd,
        "src",
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      expect(created).toMatchObject({ ok: true });
      const renamed = supported.binding.renameNoReplace(stagingHandle.fd, "src", publishedHandle.fd, "dst");
      expect(renamed).toMatchObject({ ok: true });

      const secondSource = supported.binding.openAt(
        stagingHandle.fd,
        "src2",
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      expect(secondSource).toMatchObject({ ok: true });
      const collision = supported.binding.renameNoReplace(stagingHandle.fd, "src2", publishedHandle.fd, "dst");
      expect(collision).toMatchObject({ ok: false, errno: 17 });
      const missingSource = supported.binding.renameNoReplace(stagingHandle.fd, "gone", publishedHandle.fd, "dst2");
      expect(missingSource).toMatchObject({ ok: false, errno: 2 });
    } finally {
      await stagingHandle.close();
      await publishedHandle.close();
    }
  });

  it.runIf(process.platform === "linux")("does not follow a symlink at the leaf name", async () => {
    if (!supported.ok) return;
    const directory = await mkdtemp(path.join(tmpdir(), "evidence-native-"));
    directories.push(directory);
    const outside = path.join(directory, "outside");
    await writeFile(outside, "outside-bytes");
    const { open } = await import("node:fs/promises");
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    try {
      await symlink(outside, path.join(directory, "link-name"));
      const createOverSymlink = supported.binding.openAt(
        handle.fd,
        "link-name",
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      // O_NOFOLLOW|O_CREAT|O_EXCL on an existing symlink fails with EEXIST
      // and the target is never opened for write.
      expect(createOverSymlink).toEqual({ ok: false, errno: 17 });
      const openThroughSymlink = supported.binding.openAt(
        handle.fd,
        "link-name",
        constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      expect(openThroughSymlink).toEqual({ ok: false, errno: /* ELOOP */ 40 });
    } finally {
      await handle.close();
    }
  });
});

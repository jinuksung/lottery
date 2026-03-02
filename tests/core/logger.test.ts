import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { createLogger } from "../../src/core/logger";

class MemoryWritable extends Writable {
  public chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }
}

describe("core/logger", () => {
  test("writes formatted log lines to file and stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lottery-logger-"));
    const logPath = join(dir, "run-once.log");
    const out = new MemoryWritable();
    const err = new MemoryWritable();
    const logger = createLogger({
      logFilePath: logPath,
      stdout: out,
      stderr: err
    });

    logger.info("site opened", { step: "1/5" });
    logger.error("login failed", { reason: "password" });

    const saved = await readFile(logPath, "utf8");
    expect(saved).toContain("INFO");
    expect(saved).toContain("ERROR");
    expect(saved).toContain("site opened");
    expect(saved).toContain("login failed");

    expect(out.chunks.join("")).toContain("site opened");
    expect(err.chunks.join("")).toContain("login failed");
  });
});

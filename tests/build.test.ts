import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

describe("build output", () => {
  beforeAll(() => {
    execSync("npm run build", { stdio: "pipe" });
  }, 30_000);

  it("produces minified bundle at dist/mwa-inject.min.js", () => {
    expect(existsSync("dist/mwa-inject.min.js")).toBe(true);
  });

  it("produces debug bundle at dist/mwa-inject.js", () => {
    expect(existsSync("dist/mwa-inject.js")).toBe(true);
  });

  it("minified bundle is under 150,000 bytes", () => {
    const content = readFileSync("dist/mwa-inject.min.js");
    expect(content.length).toBeLessThan(150_000);
  });

  it("minified bundle contains IIFE-wrapped code", () => {
    const content = readFileSync("dist/mwa-inject.min.js", "utf-8");
    expect(content).toContain("(()=>{");
  });

  it("debug bundle contains readable function names", () => {
    const content = readFileSync("dist/mwa-inject.js", "utf-8");
    expect(content).toContain("inject");
    expect(content).toContain("guard");
    expect(content).toContain("buildConfig");
  });
});

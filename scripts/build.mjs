import * as esbuild from "esbuild";
import { stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { minified, debug, cli } from "../esbuild.config.mjs";

const MAX_BUNDLE_SIZE = 150_000;

async function build() {
  // Type-check
  console.log("Type-checking...");
  execSync("npx tsc --noEmit", { stdio: "inherit" });

  // Build both variants
  console.log("Building minified payload...");
  await esbuild.build(minified);

  console.log("Building debug payload...");
  await esbuild.build(debug);

  console.log("Building CLI...");
  await esbuild.build(cli);

  // Size check
  const { size } = await stat("dist/mwa-inject.min.js");
  const kb = (size / 1024).toFixed(1);

  if (size >= MAX_BUNDLE_SIZE) {
    console.error(
      `ERROR: Bundle ${size} bytes (${kb} KB) exceeds ${MAX_BUNDLE_SIZE} byte limit`,
    );
    process.exit(1);
  }

  console.log(
    `Bundle: ${size} bytes (${kb} KB) — within ${MAX_BUNDLE_SIZE / 1000} KB limit`,
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

const base = {
  entryPoints: ["src/payload/index.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  globalName: "__mwaInject",
};

export const minified = {
  ...base,
  outfile: "dist/mwa-inject.min.js",
  minify: true,
};

export const debug = {
  ...base,
  outfile: "dist/mwa-inject.js",
  minify: false,
  keepNames: true,
};

export const cli = {
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node18"],
  outfile: "dist/cli.js",
  external: ["ws"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

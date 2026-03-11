---
id: "1-2-payload-config-build"
status: ready
created: 2026-03-11
---

# Story: Payload Config, Registration & IIFE Build

## User Story
As a QA Engineer, I want the injection payload to derive app identity from the page context, call `registerMwa()`, and be built as a self-contained IIFE bundle, so that the CLI can deliver it to any dApp page via CDP.

## Acceptance Criteria
- AC-1: Given `src/payload/config.ts` exists, When `buildConfig()` is called on a page with `document.title = "Jupiter"` and `location.origin = "https://jup.ag"`, Then it returns `{ appIdentity: { name: "Jupiter", uri: "https://jup.ag" }, chains: ["solana:mainnet", "solana:devnet", "solana:testnet"] }`
- AC-2: Given a page with `<link rel="icon" href="/favicon.png">`, When `buildConfig()` is called, Then `appIdentity.icon` is `"https://jup.ag/favicon.png"`
- AC-3: Given no favicon link element and no `/favicon.ico`, When `buildConfig()` is called, Then `appIdentity.icon` is `undefined`
- AC-4: Given `src/payload/index.ts` exists, When the IIFE executes in a valid environment (Android, HTTPS, not injected), Then it calls `registerMwa()` with the derived config, sets `window.__MWA_INJECTED__ = true`, logs `"[MWA Inject] Wallet registered successfully"`, and returns `{ success: true, reason: "registered" }`
- AC-5: Given the IIFE executes in an invalid environment, When guard returns `canInject: false`, Then it logs `"[MWA Inject] Skipped: {reason}"` and returns `{ success: false, reason: "{guard_reason}" }`
- AC-6: Given `npm run build` completes, Then `dist/mwa-inject.min.js` (minified IIFE) and `dist/mwa-inject.js` (debug, readable names) both exist
- AC-7: Given `dist/mwa-inject.min.js` exists, When its file size is checked, Then it is < 150,000 bytes; if it exceeds 150,000 bytes the build fails with exit code 1

## Architecture Guardrails

### Project Structure (DD-9 LOCKED)
Separate `src/cli/` and `src/payload/` directories. Payload is bundled into browser IIFE, CLI is compiled to Node.js CJS. They share no code at runtime.

```
src/payload/
├── index.ts          # IIFE entry: guard -> config -> register -> confirm
├── guard.ts          # Idempotency + environment validation (Story 1-1, exists)
├── config.ts         # Derive registerMwa() options from page context (THIS story)
└── constants.ts      # Shared constants (Story 1-1, exists)
```

### Component: payload/config.ts
- **Responsibility:** Derive `appIdentity` from `document.title` / `location.origin`, favicon discovery (`link[rel~="icon"]` then `/favicon.ico` fallback then omit), set chains from constants, provide defaults for `authorizationCache`, `chainSelector`, and `onWalletNotFound` using library-provided factories.
- **Interface:** `buildConfig(): MwaRegistrationConfig`
- **Favicon discovery algorithm:**
  1. Query `document.querySelector('link[rel~="icon"]')`
  2. If found, resolve the `href` attribute to an absolute URL using `new URL(href, location.origin).href`
  3. If not found, `icon` is `undefined` (no `/favicon.ico` fallback probe -- AC-3 states that when no favicon link element exists, icon is `undefined`)
- **App name fallback:** `document.title || location.hostname`

### Component: payload/index.ts
- **Responsibility:** IIFE entry point. Calls `guard()`, if allowed calls `buildConfig()` then `registerMwa()`, sets `window.__MWA_INJECTED__ = true`, logs result, returns status object.
- **Interface:** Self-executing function, returns `{ success: boolean, reason: string }`
- **Flow:**
  1. Call `guard()` from `./guard.js`
  2. If `canInject` is `false`: log `"[MWA Inject] Skipped: {reason}"` via `console.warn`, return `{ success: false, reason: guardResult.reason }`
  3. If `canInject` is `true`: call `buildConfig()`, call `registerMwa(config)`, set `(window as any)[INJECTED_FLAG] = true`, log `"[MWA Inject] Wallet registered successfully"` via `console.log`, return `{ success: true, reason: "registered" }`
  4. Wrap the registration call in try/catch: on error, log `"[MWA Inject] Error: {message}"` via `console.error`, return `{ success: false, reason: "error" }`

### Boundary Rule
The payload has ZERO awareness of the CLI. It works identically when pasted manually into DevTools (UC-4). The CLI reads the built payload file and sends it as a string via `Runtime.evaluate` or `Page.addScriptToEvaluateOnNewDocument`.

### Non-Negotiable Boundaries (applicable to this story)
- esbuild bundler (DD-1 LOCKED) -- used for IIFE build
- No web3.js (DD-2 LOCKED) -- `registerMwa()` from `@solana-mobile/wallet-standard-mobile` is the only runtime dependency
- Idempotency via `window.__MWA_INJECTED__` (DD-3 LOCKED) -- payload sets this flag after successful registration
- All three chains registered (DD-5 LOCKED) -- `CHAINS` constant used in config
- App identity derived from page context (DD-6 LOCKED) -- `buildConfig()` reads document.title, location.origin, favicon

### Amendment A-1 Impact
A-1 changed the primary injection strategy to inject-before-load (`Page.addScriptToEvaluateOnNewDocument` + `Page.reload`). The payload itself is unaffected -- it executes the same IIFE logic regardless of delivery method. The IIFE format supports both `Runtime.evaluate` and `Page.addScriptToEvaluateOnNewDocument`. No changes needed in this story.

### Build System (DD-1 LOCKED)
- **Bundler:** esbuild (already installed as devDependency at `^0.27.3`)
- **Build config file:** `esbuild.config.mjs` -- exports esbuild configuration
- **Build orchestrator:** `scripts/build.ts` -- runs esbuild for both outputs, then checks bundle size
- **Outputs:**
  - `dist/mwa-inject.min.js` -- minified IIFE, must be < 150,000 bytes
  - `dist/mwa-inject.js` -- debug IIFE, readable names (no minification)
- **`npm run build` script:** Update from `tsc --noEmit` (Story 1-1 placeholder) to run the esbuild-based build pipeline
- **esbuild configuration:**
  - `entryPoints: ["src/payload/index.ts"]`
  - `bundle: true`
  - `format: "iife"`
  - `platform: "browser"`
  - `target: ["chrome100"]` (NFR-2: Chrome 100+)
  - For minified: `minify: true`, `outfile: "dist/mwa-inject.min.js"`
  - For debug: `minify: false`, `keepNames: true`, `outfile: "dist/mwa-inject.js"`
- **Size check:** After build, read `dist/mwa-inject.min.js` file size. If >= 150,000 bytes, print error message and `process.exit(1)`.

## Data Models

### MwaRegistrationConfig (config passed to registerMwa)

The `registerMwa` function from `@solana-mobile/wallet-standard-mobile` accepts a config object. The `buildConfig()` function must produce a value matching this shape:

```typescript
/**
 * Config object passed to registerMwa().
 * This is NOT a new type we define -- it matches the registerMwa parameter type
 * from @solana-mobile/wallet-standard-mobile.
 */
interface MwaRegistrationConfig {
  appIdentity: AppIdentity;        // from @solana-mobile/mobile-wallet-adapter-protocol
  authorizationCache: AuthorizationCache;
  chains: IdentifierArray;         // readonly string[] from @wallet-standard/base
  chainSelector: ChainSelector;
  onWalletNotFound: (mobileWalletAdapter: SolanaMobileWalletAdapterWallet) => Promise<void>;
}
```

### AppIdentity (from @solana-mobile/mobile-wallet-adapter-protocol)

```typescript
type AppIdentity = Readonly<{
  uri?: string;    // location.origin
  icon?: string;   // favicon href if found, undefined otherwise
  name?: string;   // document.title || location.hostname
}>;
```

Note: All fields are optional in the library type. Our `buildConfig()` always provides `name` and `uri`, and conditionally provides `icon`.

### IIFE Return Value

```typescript
interface InjectionResult {
  success: boolean;
  reason: string;   // "registered" | GuardReason | "error"
}
```

This is NOT a formal exported type -- it is the shape of the value returned by the IIFE's self-executing function. The CLI reads this via `Runtime.evaluate`'s `returnByValue: true`.

## Verified Interfaces

### guard() -- from Story 1-1
- **Source:** `src/payload/guard.ts:12`
- **Signature:** `export function guard(): GuardResult`
- **Types:**
  ```typescript
  export type GuardReason = "already_injected" | "not_android" | "not_secure_context";
  export type GuardResult =
    | { canInject: true }
    | { canInject: false; reason: GuardReason };
  ```
- **Plan match:** WARNING MISMATCH -- Plan's Interface Contracts section says `interface GuardResult { canInject: boolean; reason?: GuardReason }` but actual source uses a discriminated union. **Using actual source signature.** The discriminated union is stricter and better -- when `canInject` is `true`, `reason` does not exist on the type (not just `undefined`). Code consuming `guard()` must narrow via `if (!result.canInject)` to access `result.reason`.

### INJECTED_FLAG -- from Story 1-1
- **Source:** `src/payload/constants.ts:1`
- **Signature:** `export const INJECTED_FLAG = "__MWA_INJECTED__" as const`
- **Plan match:** Matches

### LOG_PREFIX -- from Story 1-1
- **Source:** `src/payload/constants.ts:3`
- **Signature:** `export const LOG_PREFIX = "[MWA Inject]" as const`
- **Plan match:** Matches

### CHAINS -- from Story 1-1
- **Source:** `src/payload/constants.ts:5-9`
- **Signature:** `export const CHAINS = ["solana:mainnet", "solana:devnet", "solana:testnet"] as const`
- **Plan match:** Matches

### registerMwa() -- from @solana-mobile/wallet-standard-mobile
- **Source:** `@solana-mobile/wallet-standard-mobile@0.5.0-beta2` (extracted from `lib/types/index.browser.d.ts:71-78`)
- **Signature:**
  ```typescript
  declare function registerMwa(config: {
    appIdentity: AppIdentity;
    authorizationCache: AuthorizationCache;
    chains: IdentifierArray;
    chainSelector: ChainSelector;
    remoteHostAuthority?: string;
    onWalletNotFound: (mobileWalletAdapter: SolanaMobileWalletAdapterWallet) => Promise<void>;
  }): void;
  ```
- **Plan match:** WARNING MISMATCH -- Architecture's `RegisterMwaConfig` only shows `appIdentity`, `chains`, and `authorizationCache`. The actual `registerMwa()` function ALSO requires `chainSelector` and `onWalletNotFound` (both mandatory), plus optional `remoteHostAuthority`. **Using actual library signature.** The `buildConfig()` function must provide all required fields using the library's factory functions:
  - `createDefaultAuthorizationCache()` for `authorizationCache`
  - `createDefaultChainSelector()` for `chainSelector`
  - `createDefaultWalletNotFoundHandler()` for `onWalletNotFound`

### Helper factories -- from @solana-mobile/wallet-standard-mobile
- **Source:** `@solana-mobile/wallet-standard-mobile@0.5.0-beta2` (extracted from `lib/types/index.browser.d.ts:80-82`)
- **Signatures:**
  ```typescript
  declare function createDefaultAuthorizationCache(): AuthorizationCache;
  declare function createDefaultChainSelector(): ChainSelector;
  declare function createDefaultWalletNotFoundHandler(): (mobileWalletAdapter: SolanaMobileWalletAdapterWallet) => Promise<void>;
  ```
- **Plan match:** Architecture mentions `authorizationCache: object // default localStorage cache` but does not mention `chainSelector` or `onWalletNotFound`. All three have factory defaults exported by the library.

## Tasks
- [ ] Task 1: Install `@solana-mobile/wallet-standard-mobile` as a production dependency
  - Maps to: AC-4, AC-6 (required for `registerMwa()` to be bundled into IIFE)
  - Files: `package.json` (modified)
  - Details:
    - `npm install @solana-mobile/wallet-standard-mobile@0.5.0-beta2`
    - This is the ONLY runtime dependency. It gets bundled into the IIFE by esbuild.
    - Verify it installs without errors.
    - Note: This is a beta version (0.5.0-beta2). The latest stable is 0.4.4. Use the beta because it is the latest published version and the architecture references current MWA APIs.

- [ ] Task 2: Create `src/payload/config.ts` with `buildConfig()` function
  - Maps to: AC-1, AC-2, AC-3
  - Files: `src/payload/config.ts` (created)
  - Details:
    - Import `CHAINS` from `./constants.js`
    - Import `registerMwa`, `createDefaultAuthorizationCache`, `createDefaultChainSelector`, `createDefaultWalletNotFoundHandler` from `@solana-mobile/wallet-standard-mobile`
    - Export `function buildConfig()` that returns an object matching `registerMwa`'s config parameter type
    - `appIdentity.name`: `document.title || location.hostname`
    - `appIdentity.uri`: `location.origin`
    - `appIdentity.icon`: Query `document.querySelector('link[rel~="icon"]')`. If element exists and has `href`, resolve to absolute URL via `new URL(href, location.origin).href`. Otherwise `undefined`.
    - `chains`: `[...CHAINS]` (spread the readonly tuple into a mutable array)
    - `authorizationCache`: `createDefaultAuthorizationCache()`
    - `chainSelector`: `createDefaultChainSelector()`
    - `onWalletNotFound`: `createDefaultWalletNotFoundHandler()`
    - The return type should be inferred or explicitly typed to match `registerMwa`'s config parameter. Consider using `Parameters<typeof registerMwa>[0]` as the return type for type-safety.

- [ ] Task 3: Create `tests/payload/config.test.ts` with unit tests
  - Maps to: AC-1, AC-2, AC-3
  - Files: `tests/payload/config.test.ts` (created)
  - Details:
    - Mock `document.title`, `document.querySelector`, `location.origin`, `location.hostname` using `vi.stubGlobal()`
    - Mock `@solana-mobile/wallet-standard-mobile` using `vi.mock()` -- mock `createDefaultAuthorizationCache`, `createDefaultChainSelector`, `createDefaultWalletNotFoundHandler` to return stub objects/functions
    - Test: title "Jupiter" + origin "https://jup.ag" -> `appIdentity.name === "Jupiter"`, `appIdentity.uri === "https://jup.ag"`
    - Test: chains equals `["solana:mainnet", "solana:devnet", "solana:testnet"]`
    - Test: `<link rel="icon" href="/favicon.png">` exists -> `appIdentity.icon === "https://jup.ag/favicon.png"`
    - Test: `<link rel="shortcut icon" href="/icon.ico">` (rel contains "icon") -> icon resolved correctly
    - Test: no favicon link element -> `appIdentity.icon === undefined`
    - Test: empty document.title -> falls back to `location.hostname`
    - Test: authorizationCache, chainSelector, onWalletNotFound are present in returned config
    - Use `afterEach(() => vi.unstubAllGlobals())` pattern established in Story 1-1

- [ ] Task 4: Create `src/payload/index.ts` -- IIFE entry point
  - Maps to: AC-4, AC-5
  - Files: `src/payload/index.ts` (created)
  - Details:
    - Import `guard` from `./guard.js`
    - Import `buildConfig` from `./config.js`
    - Import `registerMwa` from `@solana-mobile/wallet-standard-mobile`
    - Import `INJECTED_FLAG`, `LOG_PREFIX` from `./constants.js`
    - Wrap entire module body in a self-executing function: `(function() { ... })()`
    - esbuild's `format: "iife"` will wrap it again, so the inner function can also just be top-level module code that esbuild wraps. Prefer top-level module code -- esbuild handles the IIFE wrapping.
    - Flow:
      1. `const guardResult = guard()`
      2. If `!guardResult.canInject`: `console.warn(\`${LOG_PREFIX} Skipped: ${guardResult.reason}\`)`, return `{ success: false, reason: guardResult.reason }`
      3. Try: `const config = buildConfig()`, `registerMwa(config)`, `(window as unknown as Record<string, unknown>)[INJECTED_FLAG] = true`, `console.log(\`${LOG_PREFIX} Wallet registered successfully\`)`, return `{ success: true, reason: "registered" }`
      4. Catch: `console.error(\`${LOG_PREFIX} Error: ${(e as Error).message}\`)`, return `{ success: false, reason: "error" }`

- [ ] Task 5: Create `tests/payload/index.test.ts` with unit tests
  - Maps to: AC-4, AC-5
  - Files: `tests/payload/index.test.ts` (created)
  - Details:
    - Mock `./guard.js` using `vi.mock()` to control guard return values
    - Mock `./config.js` using `vi.mock()` to return a stub config
    - Mock `@solana-mobile/wallet-standard-mobile` using `vi.mock()` -- mock `registerMwa` as `vi.fn()`
    - Mock `window` globals (INJECTED_FLAG property, console.log, console.warn, console.error)
    - The test must import and execute the module -- since it's top-level code that esbuild wraps as IIFE, the test needs to dynamically import the module to trigger execution. Use `vi.resetModules()` + dynamic `import()` pattern for each test.
    - Test: valid environment -> `registerMwa` called with config, `window.__MWA_INJECTED__` set to true, console.log called with success message, returns `{ success: true, reason: "registered" }`
    - Test: guard returns `canInject: false, reason: "not_android"` -> `registerMwa` NOT called, console.warn called with skip message, returns `{ success: false, reason: "not_android" }`
    - Test: guard returns `canInject: false, reason: "already_injected"` -> returns `{ success: false, reason: "already_injected" }`
    - Test: `registerMwa` throws -> console.error called, returns `{ success: false, reason: "error" }`
    - Note: Testing top-level side-effecting modules requires careful module reset between tests.

- [ ] Task 6: Create `esbuild.config.mjs` and `scripts/build.ts`, update `npm run build`
  - Maps to: AC-6, AC-7
  - Files: `esbuild.config.mjs` (created), `scripts/build.ts` (created), `package.json` (modified)
  - Details:
    - `esbuild.config.mjs`: Export a function or config objects for both build variants:
      ```javascript
      // Shared base config
      const base = {
        entryPoints: ["src/payload/index.ts"],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: ["chrome100"],
      };
      // Minified
      export const minified = { ...base, outfile: "dist/mwa-inject.min.js", minify: true };
      // Debug
      export const debug = { ...base, outfile: "dist/mwa-inject.js", minify: false, keepNames: true };
      ```
    - `scripts/build.ts`: Build orchestrator script
      - Import esbuild and configs
      - Run both builds (minified + debug)
      - After builds complete, check file size of `dist/mwa-inject.min.js`
      - If size >= 150,000 bytes: print `"ERROR: Bundle ${size} bytes exceeds 150,000 byte limit"`, `process.exit(1)`
      - If size < 150,000: print `"Bundle: ${size} bytes (${(size/1024).toFixed(1)} KB) -- within 150 KB limit"`
      - Also run `tsc --noEmit` for type-checking (preserve the type-check from Story 1-1)
    - Update `package.json` `scripts.build`:
      - From: `"tsc --noEmit"`
      - To: `"node --import tsx scripts/build.ts"` or `"npx tsx scripts/build.ts"` (tsx is needed to run .ts build script directly)
      - Alternatively, write `scripts/build.mjs` in plain JS to avoid needing tsx. Prefer `.mjs` to minimize dependencies.
    - Consider writing `scripts/build.mjs` instead of `.ts` to use esbuild's JS API directly without a TS runner:
      ```javascript
      import * as esbuild from "esbuild";
      import { stat } from "node:fs/promises";
      // ... build and size check
      ```

- [ ] Task 7: Create `tests/build.test.ts` -- integration test for build output
  - Maps to: AC-6, AC-7
  - Files: `tests/build.test.ts` (created)
  - Details:
    - This is an integration test that runs the actual build and verifies outputs
    - Test: After build, `dist/mwa-inject.min.js` exists
    - Test: After build, `dist/mwa-inject.js` exists
    - Test: `dist/mwa-inject.min.js` file size < 150,000 bytes
    - Test: `dist/mwa-inject.min.js` contains IIFE-wrapped code (starts with `(` or `!` or similar minified pattern)
    - Test: `dist/mwa-inject.js` contains readable function/variable names (not fully minified)
    - Use `execSync("npm run build")` or import esbuild directly to trigger the build within the test
    - Use `node:fs` to check file existence and size
    - Mark these tests with a longer timeout since they run the build process

## must_haves
truths:
  - "buildConfig() on a page with document.title 'Jupiter' and location.origin 'https://jup.ag' returns appIdentity.name 'Jupiter' and appIdentity.uri 'https://jup.ag'"
  - "buildConfig() returns chains ['solana:mainnet', 'solana:devnet', 'solana:testnet']"
  - "buildConfig() on a page with <link rel='icon' href='/favicon.png'> returns appIdentity.icon 'https://jup.ag/favicon.png'"
  - "buildConfig() on a page with no favicon link element returns appIdentity.icon undefined"
  - "IIFE in valid environment calls registerMwa with derived config, sets window.__MWA_INJECTED__ to true, logs '[MWA Inject] Wallet registered successfully', returns { success: true, reason: 'registered' }"
  - "IIFE in invalid environment when guard returns canInject false logs '[MWA Inject] Skipped: {reason}' and returns { success: false, reason: '{guard_reason}' }"
  - "npm run build produces dist/mwa-inject.min.js (minified) and dist/mwa-inject.js (debug)"
  - "dist/mwa-inject.min.js is less than 150,000 bytes"
  - "Build fails with exit code 1 if dist/mwa-inject.min.js exceeds 150,000 bytes"
artifacts:
  - path: "src/payload/config.ts"
    contains: ["buildConfig", "appIdentity", "document.title", "location.origin", "CHAINS", "createDefaultAuthorizationCache", "createDefaultChainSelector", "createDefaultWalletNotFoundHandler"]
  - path: "src/payload/index.ts"
    contains: ["guard", "buildConfig", "registerMwa", "INJECTED_FLAG", "LOG_PREFIX", "success", "reason"]
  - path: "tests/payload/config.test.ts"
    contains: ["buildConfig", "appIdentity", "icon", "favicon", "chains"]
  - path: "tests/payload/index.test.ts"
    contains: ["registerMwa", "guard", "success", "reason", "registered", "Skipped"]
  - path: "esbuild.config.mjs"
    contains: ["entryPoints", "iife", "bundle", "minify", "mwa-inject"]
  - path: "tests/build.test.ts"
    contains: ["mwa-inject.min.js", "mwa-inject.js", "150"]
key_links:
  - pattern: "import { CHAINS"
    in: ["src/payload/config.ts"]
  - pattern: "import { guard"
    in: ["src/payload/index.ts"]
  - pattern: "import { buildConfig"
    in: ["src/payload/index.ts"]
  - pattern: "import { registerMwa"
    in: ["src/payload/index.ts"]
  - pattern: "import { INJECTED_FLAG"
    in: ["src/payload/index.ts", "src/payload/guard.ts"]
  - pattern: "import { LOG_PREFIX"
    in: ["src/payload/index.ts"]
  - pattern: "createDefaultAuthorizationCache"
    in: ["src/payload/config.ts"]
  - pattern: "createDefaultChainSelector"
    in: ["src/payload/config.ts"]
  - pattern: "createDefaultWalletNotFoundHandler"
    in: ["src/payload/config.ts"]
  - pattern: "export function buildConfig"
    in: ["src/payload/config.ts"]

## Dev Notes

### Verified Library Versions (as of 2026-03-11)
- **@solana-mobile/wallet-standard-mobile:** 0.5.0-beta2 (latest published version; latest stable is 0.4.4 but beta2 is the newest available). This is the ONLY runtime dependency -- it gets bundled into the IIFE.
  - Transitive dependencies include: `@solana/wallet-standard-chains@^1.1.0`, `@solana/wallet-standard-features@^1.2.0`, `@wallet-standard/base@^1.0.1`, `@wallet-standard/features@^1.0.3`, `@wallet-standard/wallet@^1.1.0`, `bs58@^6.0.0`, `js-base64@^3.7.5`, `qrcode@^1.5.4`, `tslib@^2.8.1`, `@solana-mobile/mobile-wallet-adapter-protocol@^2.2.5`
  - These transitive deps are all bundled by esbuild. The `qrcode` dependency may contribute significant size -- monitor bundle size carefully.
- **esbuild:** ^0.27.3 (already installed as devDependency, latest stable)
- **TypeScript:** ^5.9.3 (already installed)
- **Vitest:** ^4.0.18 (already installed)

### Conventions from Story 1-1
- **Import style:** ES modules with `.js` extensions in import paths (e.g., `import { guard } from "./guard.js"`)
- **Naming:** `camelCase` for functions/variables, `PascalCase` for types/interfaces, `UPPER_SNAKE_CASE` for constants
- **Test organization:** Mirror source structure under `tests/`. One test file per source module. `describe` blocks per function, `it` blocks per behavior.
- **Mocking pattern:** `vi.stubGlobal()` for window/document globals, `afterEach(() => vi.unstubAllGlobals())` for cleanup
- **Window property access:** Use `(window as unknown as Record<string, unknown>)[INJECTED_FLAG]` pattern for dynamic window property access (established in guard.ts)
- **Type exports:** Alongside implementations in the same file. Use `export type` for type-only exports.
- **Vitest environment:** `jsdom` for payload tests (configured in `vitest.config.ts`)

### Testing Considerations for index.ts
The payload's `index.ts` executes side effects at module load time (it is the IIFE entry point). Testing this requires:
1. Use `vi.mock()` to mock dependencies BEFORE import
2. Use `vi.resetModules()` between tests to re-trigger module execution
3. Use dynamic `import()` to load the module fresh each test
4. The module's top-level code IS the test subject -- there is no exported function to call

### Build Script Considerations
- Prefer `scripts/build.mjs` (plain JavaScript) over `scripts/build.ts` to avoid needing a TypeScript runner (tsx/ts-node) for the build script. esbuild's JS API works directly in Node.js.
- The build script replaces Story 1-1's `tsc --noEmit` placeholder. Type-checking should still happen -- either integrate `tsc --noEmit` into the build script or add a separate `typecheck` script.
- `dist/` directory should be gitignored (add to `.gitignore` if not already there).

### Architecture Data Model Discrepancy
The architecture's `RegisterMwaConfig` type shows only `appIdentity`, `chains`, and `authorizationCache`. The actual `registerMwa()` function requires two additional mandatory fields: `chainSelector` and `onWalletNotFound`. The `buildConfig()` function must provide all five fields. Use the library's factory defaults: `createDefaultAuthorizationCache()`, `createDefaultChainSelector()`, `createDefaultWalletNotFoundHandler()`.

### esbuild IIFE Behavior
When esbuild bundles with `format: "iife"`, it wraps all module code in `(()=>{...})()`. This means `src/payload/index.ts` does NOT need to manually wrap its code in an IIFE -- esbuild handles this. The module's top-level statements become the IIFE body. The return value of the IIFE needs special handling: esbuild's IIFE does not automatically return a value. To make the IIFE return a result object (for `Runtime.evaluate` to capture), use esbuild's `globalName` or `footer` option, OR structure the code so the last expression is the result. The simplest approach: assign the result to a variable and use esbuild's `footer: { js: "return __result;" }` or use `globalName` to expose the result. Alternatively, since `Runtime.evaluate` captures the last expression value, structure the top-level code so the final statement is the result object expression.

## Wave Structure
Wave 1: [Task 1, Task 2, Task 3] -- Task 1 (npm install) is a prerequisite for Task 2 (config.ts imports from the library). Task 2 must complete before Task 3 (tests import config.ts). These are sequential within Wave 1.

Wave 2: [Task 4, Task 5] -- Task 4 (index.ts) depends on Task 2 (config.ts) from Wave 1. Task 5 (index tests) depends on Task 4. Sequential within Wave 2.

Wave 3: [Task 6, Task 7] -- Task 6 (build config + script) is independent of Tasks 2-5 in terms of file conflicts but logically depends on Task 4 (index.ts must exist to bundle). Task 7 (build integration test) depends on Task 6. Sequential within Wave 3.

Note: All tasks within this story are effectively sequential due to the dependency chain: install -> config -> config tests -> index -> index tests -> build setup -> build tests. No parallelism is possible within this story.

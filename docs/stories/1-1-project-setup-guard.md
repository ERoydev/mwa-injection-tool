---
id: "1-1-project-setup-guard"
status: ready
created: 2026-03-11
---

# Story: Project Setup & Payload Constants/Guard

## User Story
As a QA Engineer, I want the project scaffolded with TypeScript, esbuild, and the injection payload's guard logic, so that the foundation exists for building the IIFE payload.

## Acceptance Criteria
- AC-1: Given a fresh clone, When `npm install` runs, Then all dependencies install without errors and `package.json` includes `engines: { "node": ">=18" }`, `scripts` for `build`, `test`, `lint`, and `format`
- AC-2: Given the project is set up, When `tsconfig.json` is inspected, Then `strict: true` is enabled
- AC-3: Given `src/payload/constants.ts` exists, When imported, Then it exports `INJECTED_FLAG = '__MWA_INJECTED__'`, `LOG_PREFIX = '[MWA Inject]'`, `CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet']`, `CDP_TIMEOUT = 10_000`, `ADB_TIMEOUT = 15_000`
- AC-4: Given `src/payload/guard.ts` exists, When `guard()` is called with `window.__MWA_INJECTED__ === true`, Then it returns `{ canInject: false, reason: "already_injected" }`
- AC-5: Given a non-Android user agent, When `guard()` is called, Then it returns `{ canInject: false, reason: "not_android" }`
- AC-6: Given `window.isSecureContext === false`, When `guard()` is called, Then it returns `{ canInject: false, reason: "not_secure_context" }`
- AC-7: Given Android UA + HTTPS + no prior injection, When `guard()` is called, Then it returns `{ canInject: true }`
- AC-8: Given the project, When `npm run lint` and `npm run format` are run, Then ESLint (`@typescript-eslint/recommended`) and Prettier execute without errors on source files

## Architecture Guardrails

### Project Structure (DD-9 LOCKED)
Separate `src/cli/` and `src/payload/` directories. Payload is bundled into browser IIFE, CLI is compiled to Node.js CJS. They share no code at runtime.

```
├── package.json          # Dependencies + scripts
├── tsconfig.json         # Strict TypeScript config
├── tsconfig.cli.json     # CLI-specific config (Node.js target)
├── esbuild.config.mjs    # Payload build: IIFE bundle
├── src/
│   ├── cli/              # Host-side Node.js (future stories)
│   └── payload/
│       ├── index.ts      # IIFE entry (future story 1-2)
│       ├── guard.ts      # Idempotency + environment validation
│       └── constants.ts  # Shared constants
└── tests/
    └── payload/
        └── guard.test.ts
```

### Component: payload/constants.ts
- **Responsibility:** Named constants shared across the payload subsystem
- **Interface:** Exported constants (no functions)
- **Exports:**
  - `INJECTED_FLAG = '__MWA_INJECTED__'` -- the `window` property name used for idempotency (DD-3 LOCKED)
  - `LOG_PREFIX = '[MWA Inject]'` -- prefix for all console output from the payload
  - `CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet']` -- all three Solana chains registered (DD-5 LOCKED)
  - `CDP_TIMEOUT = 10_000` -- milliseconds for CDP operations
  - `ADB_TIMEOUT = 15_000` -- milliseconds for ADB operations

### Component: payload/guard.ts
- **Responsibility:** Pre-injection environment validation. Checks: (1) not already injected via `window.__MWA_INJECTED__`, (2) is Android user agent, (3) is secure context (HTTPS). Returns a discriminated result.
- **Interface:** `guard(): GuardResult`
- **Check order:**
  1. If `window[INJECTED_FLAG] === true` -> `{ canInject: false, reason: "already_injected" }`
  2. If user agent does not contain "Android" -> `{ canInject: false, reason: "not_android" }`
  3. If `window.isSecureContext === false` -> `{ canInject: false, reason: "not_secure_context" }`
  4. All checks pass -> `{ canInject: true }`

### Data Models

```typescript
/**
 * Reasons the guard may reject injection.
 * The CLI MUST exhaustively handle all values when mapping to user-facing messages
 * (e.g., via Record<GuardReason, string> lookup).
 */
type GuardReason = "already_injected" | "not_android" | "not_secure_context";

/**
 * Result of the guard() pre-injection check.
 * When canInject is false, reason explains why.
 * When canInject is true, reason is undefined.
 */
interface GuardResult {
  canInject: boolean;
  reason?: GuardReason;
}
```

### Non-Negotiable Boundaries (applicable to this story)
- esbuild bundler (DD-1 LOCKED) -- used in build script
- Idempotency via `window.__MWA_INJECTED__` (DD-3 LOCKED) -- guard checks this flag
- HTTPS-only target pages (C-1) -- guard checks `isSecureContext`
- Android-only (C-2) -- guard checks user agent
- All three chains registered (DD-5 LOCKED) -- constants exports CHAINS array

### Testing Strategy
- **Test runner:** Vitest (fast, TypeScript-native, ESM support)
- **Formatter:** Prettier (default config)
- **Linter:** ESLint with `@typescript-eslint/recommended`
- **Coverage target:** >= 80% line coverage for pure logic modules (guard.ts, constants.ts)
- **Mocking:** Vitest built-in mocks -- for guard.ts, mock `window` globals (`navigator.userAgent`, `isSecureContext`, and the `__MWA_INJECTED__` property)
- **Test file location:** `tests/payload/guard.test.ts`

### Build System (DD-1 LOCKED)
- esbuild for payload IIFE bundling
- Build config in `esbuild.config.mjs`
- For this story, the `build` script only needs to exist and compile TypeScript. Full IIFE build is Story 1-2.
- The `build` script should at minimum run `tsc --noEmit` (type-check only) since the full esbuild pipeline is Story 1-2.

## Verified Interfaces

This is the first story in a greenfield project. No external interfaces to verify.

### GuardResult / GuardReason (DEFINED by this story)
- **Source:** Will be created at `src/payload/guard.ts`
- **Signature:** `guard(): GuardResult` where `type GuardReason = "already_injected" | "not_android" | "not_secure_context"` and `interface GuardResult { canInject: boolean; reason?: GuardReason }`
- **Status:** UNVERIFIED -- source not yet implemented, using plan contract
- **Consumed by:** Story 1-2 (payload index), Story 2-3 (CLI maps GuardReason to messages)

### Constants (DEFINED by this story)
- **Source:** Will be created at `src/payload/constants.ts`
- **Exports:** `INJECTED_FLAG`, `LOG_PREFIX`, `CHAINS`, `CDP_TIMEOUT`, `ADB_TIMEOUT`
- **Status:** UNVERIFIED -- source not yet implemented, using plan contract
- **Consumed by:** Story 1-2 (payload index uses INJECTED_FLAG, LOG_PREFIX, CHAINS)

## Tasks
- [x] Task 1: Initialize project with package.json, tsconfig.json, and dev dependencies
  - Maps to: AC-1, AC-2, AC-8
  - Files: `package.json`, `tsconfig.json`, `tsconfig.cli.json`, `.eslintrc.cjs` or `eslint.config.mjs`, `.prettierrc`
  - Details:
    - `npm init` with `engines: { "node": ">=18" }`
    - Install dev dependencies: `typescript`, `esbuild`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
    - `tsconfig.json` with `strict: true`, targeting ESNext/ES2022 modules for payload
    - `tsconfig.cli.json` extending base, targeting Node.js (CommonJS or ESM per preference)
    - ESLint config extending `@typescript-eslint/recommended`
    - Prettier config (defaults)
    - Scripts: `build` (tsc --noEmit for now), `test` (vitest run), `lint` (eslint src tests), `format` (prettier --check src tests)

- [x] Task 2: Create `src/payload/constants.ts` with all exported constants
  - Maps to: AC-3
  - Files: `src/payload/constants.ts`
  - Details:
    - Export `INJECTED_FLAG = '__MWA_INJECTED__'` as `const`
    - Export `LOG_PREFIX = '[MWA Inject]'` as `const`
    - Export `CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const`
    - Export `CDP_TIMEOUT = 10_000` as `const`
    - Export `ADB_TIMEOUT = 15_000` as `const`
    - Use `as const` assertions for literal types where appropriate

- [x] Task 3: Create `src/payload/guard.ts` with guard() function and types
  - Maps to: AC-4, AC-5, AC-6, AC-7
  - Files: `src/payload/guard.ts`
  - Details:
    - Export `type GuardReason = "already_injected" | "not_android" | "not_secure_context"`
    - Export `interface GuardResult { canInject: boolean; reason?: GuardReason }`
    - Export `function guard(): GuardResult`
    - Check order: (1) `window[INJECTED_FLAG]`, (2) Android UA via `navigator.userAgent`, (3) `window.isSecureContext`
    - Import `INJECTED_FLAG` from `./constants`
    - Android check: `navigator.userAgent.includes('Android')` (DD-4: no UA spoofing needed, real devices pass naturally)

- [x] Task 4: Create `tests/payload/guard.test.ts` with unit tests covering all guard branches
  - Maps to: AC-4, AC-5, AC-6, AC-7
  - Files: `tests/payload/guard.test.ts`
  - Details:
    - Test: already injected -> `{ canInject: false, reason: "already_injected" }`
    - Test: non-Android UA -> `{ canInject: false, reason: "not_android" }`
    - Test: insecure context -> `{ canInject: false, reason: "not_secure_context" }`
    - Test: valid environment (Android UA + secure context + not injected) -> `{ canInject: true }`
    - Test: `reason` is undefined when `canInject` is true
    - Mock `window` globals using Vitest: `navigator.userAgent`, `window.isSecureContext`, `window.__MWA_INJECTED__`
    - Use `vi.stubGlobal()` for window property mocking

- [x] Task 5: Verify lint and format pass on all source and test files
  - Maps to: AC-8
  - Files: none created, verification only
  - Details:
    - Run `npm run lint` -- ESLint with `@typescript-eslint/recommended` passes
    - Run `npm run format` -- Prettier check passes
    - Fix any issues found
    - Run `npm test` -- Vitest executes guard tests successfully

## must_haves
truths:
  - "guard() returns { canInject: false, reason: 'already_injected' } when window.__MWA_INJECTED__ is true"
  - "guard() returns { canInject: false, reason: 'not_android' } when navigator.userAgent does not contain 'Android'"
  - "guard() returns { canInject: false, reason: 'not_secure_context' } when window.isSecureContext is false"
  - "guard() returns { canInject: true } when Android UA + secure context + not previously injected"
  - "package.json includes engines.node >= 18 and scripts for build, test, lint, format"
  - "tsconfig.json has strict: true"
  - "INJECTED_FLAG equals '__MWA_INJECTED__'"
  - "CHAINS equals ['solana:mainnet', 'solana:devnet', 'solana:testnet']"
  - "npm run lint executes ESLint with @typescript-eslint/recommended without errors"
  - "npm run format executes Prettier without errors"
artifacts:
  - path: "package.json"
    contains: ["engines", ">=18", "build", "test", "lint", "format"]
  - path: "tsconfig.json"
    contains: ["strict", "true"]
  - path: "src/payload/constants.ts"
    contains: ["INJECTED_FLAG", "__MWA_INJECTED__", "LOG_PREFIX", "CHAINS", "CDP_TIMEOUT", "ADB_TIMEOUT"]
  - path: "src/payload/guard.ts"
    contains: ["GuardResult", "GuardReason", "guard", "canInject", "already_injected", "not_android", "not_secure_context"]
  - path: "tests/payload/guard.test.ts"
    contains: ["guard", "canInject", "already_injected", "not_android", "not_secure_context"]
key_links:
  - pattern: "import { INJECTED_FLAG"
    in: ["src/payload/guard.ts"]
  - pattern: "import { guard"
    in: ["tests/payload/guard.test.ts"]
  - pattern: "export function guard"
    in: ["src/payload/guard.ts"]
  - pattern: "export const INJECTED_FLAG"
    in: ["src/payload/constants.ts"]
  - pattern: "export const CHAINS"
    in: ["src/payload/constants.ts"]

## Dev Notes

### Verified Library Versions (as of 2026-03-11)
- **TypeScript:** ^5.8.3 (latest stable; 5.9.2 also stable, 6.0 is RC -- use 5.8 or 5.9 for stability)
- **esbuild:** ^0.27.3 (latest stable)
- **Vitest:** ^4.0.18 (latest stable)
- **ESLint:** ^9.39.3 (latest stable in 9.x line; ESLint 10.0.3 just released Feb 2026 -- use 9.x for ecosystem stability with typescript-eslint)
- **typescript-eslint:** ^8.57.0 (latest stable, supports ESLint ^8.57.0 || ^9.0.0 || ^10.0.0)
- **Prettier:** ^3.8.1 (latest stable)

### Conventions (first story -- establishing baseline)
- **Import style:** Use ES module imports. Use `node:` prefix for Node.js built-ins when they appear in CLI code (future stories).
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types/interfaces, `UPPER_SNAKE_CASE` for constants.
- **Error handling:** Payload guard returns result objects (no throwing). CLI code (future stories) uses `InjectionError` class.
- **File structure:** Feature-first organization within subsystem directories (`src/payload/`, `src/cli/`).
- **Test organization:** Mirror source structure under `tests/`. One test file per source module. Use `describe` blocks per function, `it` blocks per behavior.
- **Type exports:** Export types/interfaces alongside their implementations in the same file. Use `export type` for type-only exports where applicable.

### ESLint Configuration Notes
- Use flat config format (`eslint.config.mjs`) since ESLint 9.x is the target.
- Extend `@typescript-eslint/recommended` as required by AC-8.
- The `typescript-eslint` package provides the unified config entry point for flat config.

### tsconfig.json Key Settings
- `strict: true` (AC-2, non-negotiable)
- `noUncheckedIndexedAccess: true` (catches undefined from indexed access)
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `forceConsistentCasingInFileNames: true`
- Target: `ES2022` or `ESNext` for payload code (runs in modern Chrome on Android)
- Module: `ESNext` (esbuild handles module resolution)

### Vitest Configuration
- Configure in `vitest.config.ts` or within `package.json`
- Environment: `jsdom` for payload tests (guard.ts accesses `window`, `navigator`)
- Coverage provider: `v8` (built into Vitest)

### Amendment A-1 Impact on This Story
A-1 changed the primary injection strategy to inject-before-load (`Page.addScriptToEvaluateOnNewDocument` + `Page.reload`). This does NOT affect Story 1-1. The guard logic and constants are injection-strategy-agnostic -- they run the same regardless of how the payload is delivered to the page.

## Wave Structure
Wave 1 (single wave -- all tasks sequential within this story):
- Task 1: Project scaffolding (must come first -- other tasks depend on package.json/tsconfig)
- Task 2: Constants module (independent of guard, but guard depends on it)
- Task 3: Guard module (depends on constants from Task 2)
- Task 4: Tests (depends on guard from Task 3)
- Task 5: Lint/format verification (depends on all source files existing)

Note: This story is the sole story in Wave 1 of the plan. Tasks within are sequential due to dependency chain: scaffolding -> constants -> guard -> tests -> verification.

---
id: "2-1-error-catalog-logger"
status: ready
created: 2026-03-11
---

# Story: Error Catalog & Logger

## User Story
As a QA Engineer, I want all CLI failure modes defined in a single error catalog with clear messages and remediation hints, so that when something fails I know exactly what went wrong and how to fix it.

## Acceptance Criteria
- AC-1: Given `src/cli/errors.ts` exists, When inspected, Then it exports `enum ErrorCode` with values: `NO_DEVICE`, `DEVICE_NOT_FOUND`, `PORT_FORWARD_FAILED`, `NO_TABS`, `TAB_CONNECT_FAILED`, `PAYLOAD_EXCEPTION`, `PAYLOAD_NOT_FOUND`, `VERIFY_FAILED`, `BUNDLE_TOO_LARGE`, `TIMEOUT`
- AC-2: Given `ErrorCode`, When `ERROR_META[code]` is accessed, Then it returns `{ message: string, remediation: string, retryable: boolean }` for every enum member
- AC-3: Given `src/cli/errors.ts`, When `new InjectionError(ErrorCode.NO_DEVICE)` is constructed, Then `error.code === ErrorCode.NO_DEVICE`, `error.message` matches `ERROR_META[NO_DEVICE].message`, and `error instanceof Error === true`
- AC-4: Given `src/cli/logger.ts` exists, When `createLogger({ verbose: false })` is called, Then the returned logger has methods `info(msg)`, `success(msg)`, `error(code, msg)`, `debug(msg)` where `debug` is a no-op in non-verbose mode
- AC-5: Given `createLogger({ verbose: true })`, When `debug(msg)` is called, Then it writes to stderr with a timestamp prefix
- AC-6: Given all error codes, When each is mapped to a user-facing message, Then every `ErrorCode` has a unique message containing the step name and a remediation hint

## Architecture Guardrails

### Design Decision DD-10 (LOCKED)
Error catalog as single module (`errors.ts`). All failure modes in one location. Single module enables consistent formatting and easy documentation.

### Project Structure (DD-9 LOCKED)
Separate `src/cli/` and `src/payload/` directories. Payload is bundled into browser IIFE, CLI is compiled to Node.js CJS. They share no code at runtime.

```
src/cli/
├── errors.ts         # Error catalog — all failure codes/messages (THIS story)
├── logger.ts         # Structured logging with --verbose support (THIS story)
├── index.ts          # Entry point — orchestrates pipeline (Story 2-3)
├── device.ts         # ADB device detection + selection (Story 2-2)
└── cdp.ts            # CDP port forwarding, tab discovery, Runtime.evaluate (Story 2-2)
```

### Component: cli/errors.ts
- **Responsibility:** Error catalog with codes, messages, remediation hints, and retryable flag. Single source of truth for all CLI failure modes.
- **Interface:**
  - `enum ErrorCode` — 10 named error codes covering every CLI failure mode
  - `ERROR_META: Record<ErrorCode, ErrorMeta>` — metadata lookup keyed by error code
  - `class InjectionError extends Error` — typed error class carrying an `ErrorCode`

### Component: cli/logger.ts
- **Responsibility:** Structured logging. Normal mode outputs success/failure messages. Verbose mode adds timestamped debug-level output to stderr.
- **Interface:** Factory function `createLogger(opts: { verbose: boolean }): Logger`
- **Output targets:**
  - `info`, `success` — write to stdout (user-facing progress messages)
  - `error` — write to stderr (error messages with code and remediation)
  - `debug` — write to stderr with ISO timestamp prefix (only in verbose mode; no-op otherwise)

### Error Propagation Pattern
```
cli/device.ts  ──throws InjectionError──┐
cli/cdp.ts     ──throws InjectionError──┤
                                        ▼
cli/index.ts   ──catches──→ logger.error(code, message)
                          → cleanup (always runs)
                          → process.exit(1)
```

All errors in the CLI subsystem are `InjectionError` instances with an `ErrorCode` enum value. `cli/index.ts` (Story 2-3) wraps the pipeline in try/catch/finally. Verbose mode logs the full stack trace to stderr.

### Non-Negotiable Boundaries (applicable to this story)
- DD-10 LOCKED: Error catalog as single module (`errors.ts`)
- DD-8 LOCKED: CLI in Node.js TypeScript, not shell script
- AC-D-2: All failure modes defined with clear messages
- AC-D-7: Remediation hints for every error code

## Data Models

### ErrorCode Enum

```typescript
enum ErrorCode {
  NO_DEVICE = "NO_DEVICE",
  DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND",
  PORT_FORWARD_FAILED = "PORT_FORWARD_FAILED",
  NO_TABS = "NO_TABS",
  TAB_CONNECT_FAILED = "TAB_CONNECT_FAILED",
  PAYLOAD_EXCEPTION = "PAYLOAD_EXCEPTION",
  PAYLOAD_NOT_FOUND = "PAYLOAD_NOT_FOUND",
  VERIFY_FAILED = "VERIFY_FAILED",
  BUNDLE_TOO_LARGE = "BUNDLE_TOO_LARGE",
  TIMEOUT = "TIMEOUT",
}
```

Use string enum values (not numeric) so that logged/serialized error codes are human-readable.

### ErrorMeta Interface

```typescript
interface ErrorMeta {
  message: string;       // User-facing error message containing the step name
  remediation: string;   // Actionable fix suggestion
  retryable: boolean;    // Whether the operation can be retried
}
```

### ERROR_META Lookup Table

| Code | Step | Message | Remediation | Retryable |
|------|------|---------|-------------|-----------|
| `NO_DEVICE` | Device detection | `"No Android devices found"` | `"Check USB connection and enable USB debugging in Developer Options"` | `false` |
| `DEVICE_NOT_FOUND` | Device selection | `"Device '{serial}' not found"` | `"Run \`adb devices\` to list available devices"` | `false` |
| `PORT_FORWARD_FAILED` | CDP setup | `"Could not forward CDP port"` | `"Ensure Chrome is running on the device"` | `true` |
| `NO_TABS` | Tab discovery | `"No debuggable Chrome tabs found"` | `"Open a Solana dApp in Chrome on the device"` | `true` |
| `TAB_CONNECT_FAILED` | CDP WebSocket | `"Could not connect to tab"` | `"Try closing and reopening Chrome on the device"` | `true` |
| `PAYLOAD_EXCEPTION` | Runtime.evaluate | `"Payload threw: {exception}"` | `"Check payload build or try debug variant"` | `false` |
| `PAYLOAD_NOT_FOUND` | File read | `"Payload file not found at {path}"` | `"Run \`npm run build\` first"` | `false` |
| `VERIFY_FAILED` | Verification | `"Wallet registration could not be verified"` | `"Injection may have succeeded — check the dApp's wallet picker"` | `false` |
| `BUNDLE_TOO_LARGE` | Build | `"Bundle {size} bytes exceeds 150 KB"` | `"Audit dependencies for size"` | `false` |
| `TIMEOUT` | CDP/ADB | `"Operation timed out after {ms}ms"` | `"Check device connection and Chrome responsiveness"` | `true` |

Note: Messages with `{serial}`, `{exception}`, `{path}`, `{size}`, and `{ms}` contain template placeholders. The `ERROR_META` stores the template strings as-is (e.g., `"Device '{serial}' not found"`). The `InjectionError` constructor or a formatting utility handles substitution when creating error instances with context-specific values.

### InjectionError Class

```typescript
class InjectionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, context?: Record<string, string>) {
    const meta = ERROR_META[code];
    const message = context
      ? Object.entries(context).reduce(
          (msg, [key, val]) => msg.replace(`{${key}}`, val),
          meta.message,
        )
      : meta.message;
    super(message);
    this.name = "InjectionError";
    this.code = code;
  }
}
```

- Extends `Error` so `error instanceof Error === true` (AC-3)
- `code` property holds the `ErrorCode` enum value (AC-3)
- `message` property auto-populated from `ERROR_META` (AC-3)
- Optional `context` parameter allows template placeholder substitution for codes like `DEVICE_NOT_FOUND` (`{serial}`), `PAYLOAD_EXCEPTION` (`{exception}`), `PAYLOAD_NOT_FOUND` (`{path}`), `BUNDLE_TOO_LARGE` (`{size}`), `TIMEOUT` (`{ms}`)

### Logger Interface

```typescript
interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  error(code: ErrorCode, msg: string): void;
  debug(msg: string): void;
}
```

### createLogger Factory

```typescript
function createLogger(opts: { verbose: boolean }): Logger
```

- `info(msg)` — writes to `process.stdout` (e.g., `console.log`)
- `success(msg)` — writes to `process.stdout` with a checkmark prefix (e.g., `"✓ {msg}"`)
- `error(code, msg)` — writes to `process.stderr` (e.g., `console.error`), includes error code and remediation from `ERROR_META`
- `debug(msg)` — when `verbose` is `true`: writes to `process.stderr` with ISO timestamp prefix (e.g., `"[2026-03-11T10:30:00.000Z] {msg}"`). When `verbose` is `false`: no-op (function does nothing).

## Verified Interfaces

This story DEFINES the `ErrorCode`, `InjectionError`, `ERROR_META`, `Logger`, and `createLogger` interfaces. It does not consume external interfaces from prior stories.

### ErrorCode / InjectionError / ERROR_META (DEFINED by this story)
- **Source:** Will be created at `src/cli/errors.ts`
- **Signature:** `enum ErrorCode { NO_DEVICE, DEVICE_NOT_FOUND, PORT_FORWARD_FAILED, NO_TABS, TAB_CONNECT_FAILED, PAYLOAD_EXCEPTION, PAYLOAD_NOT_FOUND, VERIFY_FAILED, BUNDLE_TOO_LARGE, TIMEOUT }`, `class InjectionError extends Error { code: ErrorCode }`, `ERROR_META: Record<ErrorCode, { message: string, remediation: string, retryable: boolean }>`
- **Status:** UNVERIFIED — source not yet implemented, using plan contract
- **Consumed by:** Story 2-2 (device.ts and cdp.ts throw `InjectionError`), Story 2-3 (index.ts catches `InjectionError` and logs via `logger.error`)

### Logger / createLogger (DEFINED by this story)
- **Source:** Will be created at `src/cli/logger.ts`
- **Signature:** `createLogger(opts: { verbose: boolean }): Logger` with `info(msg: string): void`, `success(msg: string): void`, `error(code: ErrorCode, msg: string): void`, `debug(msg: string): void`
- **Status:** UNVERIFIED — source not yet implemented, using plan contract
- **Consumed by:** Story 2-2 (optional logging), Story 2-3 (orchestrator logs all steps)

## Tasks
- [x] Task 1: Create `src/cli/errors.ts` with ErrorCode enum, ErrorMeta interface, ERROR_META lookup, and InjectionError class
  - Maps to: AC-1, AC-2, AC-3, AC-6
  - Files: `src/cli/errors.ts` (created)
  - Details:
    - Export `enum ErrorCode` with all 10 string-valued members
    - Export `interface ErrorMeta { message: string; remediation: string; retryable: boolean }`
    - Export `const ERROR_META: Record<ErrorCode, ErrorMeta>` with entries for all 10 codes matching the table in Data Models above
    - Export `class InjectionError extends Error` with `readonly code: ErrorCode`, constructor accepting `ErrorCode` and optional `context` for template substitution
    - Every message must contain the step name (AC-6): "Device detection" for NO_DEVICE, "Device selection" for DEVICE_NOT_FOUND, etc. — the message templates in the ERROR_META table implicitly reference the step via their content
    - Every message must be unique across all codes (AC-6)

- [x] Task 2: Create `src/cli/logger.ts` with createLogger factory and Logger interface
  - Maps to: AC-4, AC-5
  - Files: `src/cli/logger.ts` (created)
  - Details:
    - Export `interface Logger { info(msg: string): void; success(msg: string): void; error(code: ErrorCode, msg: string): void; debug(msg: string): void }`
    - Export `function createLogger(opts: { verbose: boolean }): Logger`
    - `info` — `console.log(msg)`
    - `success` — `console.log("✓ " + msg)` or similar prefix
    - `error` — `console.error(msg)` with code and remediation from ERROR_META: format as `"Error [${code}]: ${msg}\n  Remediation: ${ERROR_META[code].remediation}"`
    - `debug` — when `opts.verbose` is true: `process.stderr.write("[${new Date().toISOString()}] ${msg}\n")`. When false: empty function body (no-op).
    - Import `ErrorCode` and `ERROR_META` from `./errors.js`

- [x] Task 3: Create `tests/cli/errors.test.ts` with unit tests for errors module
  - Maps to: AC-1, AC-2, AC-3, AC-6
  - Files: `tests/cli/errors.test.ts` (created)
  - Details:
    - Test: `ErrorCode` enum has exactly 10 members with expected names
    - Test: `ERROR_META[code]` returns an object with `message`, `remediation`, `retryable` for EVERY `ErrorCode` member (iterate over all enum values)
    - Test: Every `ERROR_META[code].message` is unique across all codes
    - Test: Every `ERROR_META[code].remediation` is a non-empty string
    - Test: `new InjectionError(ErrorCode.NO_DEVICE)` produces `error.code === ErrorCode.NO_DEVICE`
    - Test: `new InjectionError(ErrorCode.NO_DEVICE)` produces `error.message === ERROR_META[ErrorCode.NO_DEVICE].message`
    - Test: `new InjectionError(ErrorCode.NO_DEVICE) instanceof Error === true`
    - Test: `new InjectionError(ErrorCode.NO_DEVICE) instanceof InjectionError === true`
    - Test: `new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial: "abc123" })` produces `error.message` containing `"abc123"` (template substitution)
    - Test: `new InjectionError(ErrorCode.NO_DEVICE).name === "InjectionError"`

- [x] Task 4: Create `tests/cli/logger.test.ts` with unit tests for logger module
  - Maps to: AC-4, AC-5
  - Files: `tests/cli/logger.test.ts` (created)
  - Details:
    - Test: `createLogger({ verbose: false })` returns object with `info`, `success`, `error`, `debug` methods
    - Test: Non-verbose logger `debug("test")` does NOT write to stderr (mock `process.stderr.write` and `console.error`, verify not called)
    - Test: Non-verbose logger `info("hello")` writes to stdout (spy on `console.log`)
    - Test: Non-verbose logger `success("done")` writes to stdout with checkmark prefix
    - Test: Non-verbose logger `error(ErrorCode.NO_DEVICE, "msg")` writes to stderr and includes remediation
    - Test: `createLogger({ verbose: true })` `debug("test")` writes to stderr with ISO timestamp prefix
    - Test: Verbose debug output includes the message content
    - Mock `console.log`, `console.error`, `process.stderr.write` using `vi.spyOn` — restore after each test
    - For timestamp verification: use a regex pattern like `/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/` to verify ISO format without brittle exact-time matching

- [x] Task 5: Verify lint, format, and typecheck pass on all new files
  - Maps to: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6 (all — ensures code quality)
  - Files: none created, verification only
  - Details:
    - Run `npm run lint` — ESLint passes on `src/cli/errors.ts`, `src/cli/logger.ts`, `tests/cli/errors.test.ts`, `tests/cli/logger.test.ts`
    - Run `npm run format` — Prettier check passes
    - Run `npm run typecheck` — TypeScript type-check passes (`tsc --noEmit`)
    - Run `npm test` — all tests pass (existing payload tests still pass + new CLI tests pass)

## must_haves
truths:
  - "ErrorCode enum exports exactly 10 members: NO_DEVICE, DEVICE_NOT_FOUND, PORT_FORWARD_FAILED, NO_TABS, TAB_CONNECT_FAILED, PAYLOAD_EXCEPTION, PAYLOAD_NOT_FOUND, VERIFY_FAILED, BUNDLE_TOO_LARGE, TIMEOUT"
  - "ERROR_META[code] returns { message: string, remediation: string, retryable: boolean } for every ErrorCode member"
  - "new InjectionError(ErrorCode.NO_DEVICE) produces error.code === ErrorCode.NO_DEVICE and error.message === ERROR_META[ErrorCode.NO_DEVICE].message and error instanceof Error === true"
  - "new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial: 'abc123' }) produces error.message containing 'abc123'"
  - "Every ErrorCode has a unique message string and a non-empty remediation hint"
  - "createLogger({ verbose: false }) returns a Logger with info, success, error, debug methods where debug is a no-op"
  - "createLogger({ verbose: true }).debug(msg) writes to stderr with an ISO timestamp prefix"
  - "logger.error(code, msg) writes to stderr and includes the remediation hint from ERROR_META"
artifacts:
  - path: "src/cli/errors.ts"
    contains: ["ErrorCode", "NO_DEVICE", "DEVICE_NOT_FOUND", "PORT_FORWARD_FAILED", "NO_TABS", "TAB_CONNECT_FAILED", "PAYLOAD_EXCEPTION", "PAYLOAD_NOT_FOUND", "VERIFY_FAILED", "BUNDLE_TOO_LARGE", "TIMEOUT", "ERROR_META", "InjectionError", "ErrorMeta"]
  - path: "src/cli/logger.ts"
    contains: ["Logger", "createLogger", "verbose", "info", "success", "error", "debug", "stderr"]
  - path: "tests/cli/errors.test.ts"
    contains: ["ErrorCode", "ERROR_META", "InjectionError", "instanceof", "message", "remediation"]
  - path: "tests/cli/logger.test.ts"
    contains: ["createLogger", "verbose", "debug", "stderr", "timestamp", "info", "success", "error"]
key_links:
  - pattern: "export enum ErrorCode"
    in: ["src/cli/errors.ts"]
  - pattern: "export const ERROR_META"
    in: ["src/cli/errors.ts"]
  - pattern: "export class InjectionError"
    in: ["src/cli/errors.ts"]
  - pattern: "export interface ErrorMeta"
    in: ["src/cli/errors.ts"]
  - pattern: "export interface Logger"
    in: ["src/cli/logger.ts"]
  - pattern: "export function createLogger"
    in: ["src/cli/logger.ts"]
  - pattern: "import { ErrorCode"
    in: ["src/cli/logger.ts", "tests/cli/errors.test.ts", "tests/cli/logger.test.ts"]
  - pattern: "import { ERROR_META"
    in: ["src/cli/logger.ts", "tests/cli/errors.test.ts"]
  - pattern: "import { InjectionError"
    in: ["tests/cli/errors.test.ts"]
  - pattern: "import { createLogger"
    in: ["tests/cli/logger.test.ts"]

## Dev Notes

### Vitest Environment for CLI Tests
The current `vitest.config.ts` sets `environment: "jsdom"` globally. CLI modules (`src/cli/`) target Node.js, not the browser. CLI tests should run in a Node.js environment, not jsdom. Configure per-test-file environment using Vitest's in-source environment directive:

```typescript
// At the top of tests/cli/errors.test.ts and tests/cli/logger.test.ts:
// @vitest-environment node
```

Alternatively, update `vitest.config.ts` to use per-directory environment overrides:
```typescript
environmentMatchGlobs: [
  ["tests/payload/**", "jsdom"],
  ["tests/cli/**", "node"],
]
```

The preferred approach is `environmentMatchGlobs` in vitest.config.ts — it is centralized and does not require magic comments in every test file. However, the in-source directive is also acceptable. Choose one approach and apply it consistently.

### Conventions from Prior Stories (Stories 1-1, 1-2)
- **Import style:** ES modules with `.js` extensions in import paths (e.g., `import { ErrorCode } from "./errors.js"`)
- **Naming:** `camelCase` for functions/variables, `PascalCase` for types/interfaces/classes, `UPPER_SNAKE_CASE` for constants and enum values
- **Test organization:** Mirror source structure under `tests/`. One test file per source module. `describe` blocks per function/class, `it` blocks per behavior.
- **Mocking pattern:** `vi.spyOn()` for spying on existing methods (preferred for `console.log`, `console.error`, `process.stderr.write`). `vi.stubGlobal()` for replacing globals. `afterEach(() => { vi.restoreAllMocks(); })` for cleanup.
- **Window property access:** `(window as unknown as Record<string, unknown>)[KEY]` pattern for dynamic properties (established in guard.ts — not needed in this story since CLI code does not access `window`)
- **Type exports:** Alongside implementations in the same file. `export type` for type-only exports where applicable. `export interface` for interfaces.
- **Error handling in tests:** Use narrowing via `if (!result.canInject)` before accessing discriminated union properties (established in guard.test.ts lines 68-70)
- **Test data:** Define test constants at the top of test files (e.g., `const ANDROID_UA = "..."` pattern from guard.test.ts)
- **ESLint:** Flat config in `eslint.config.mjs` using `typescript-eslint` package. Extends `@typescript-eslint/recommended` + `@typescript-eslint/strict`.
- **Prettier:** Empty config (`{}` in `.prettierrc`) — uses all defaults.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, target `ES2022`, module `ESNext`, moduleResolution `bundler`.

### Verified Library Versions (as of 2026-03-11)
- **Vitest:** ^4.0.18 (latest stable, already installed)
- **TypeScript:** ^5.9.3 (already installed)
- **ESLint:** ^10.0.3 (already installed)
- **Prettier:** ^3.8.1 (already installed)

No new dependencies are required for this story. The error catalog and logger use only Node.js built-ins (`process.stderr`, `console`, `Date`). No external logging library needed — the logger is lightweight and purpose-built.

### Amendment A-1 Impact on This Story
A-1 changed the primary injection strategy to inject-before-load (`Page.addScriptToEvaluateOnNewDocument` + `Page.reload`). This does NOT affect Story 2-1. The error catalog and logger define error codes and messages that are consumed by later stories (2-2, 2-3). The error codes themselves are injection-strategy-agnostic.

### String Enum Rationale
Use string-valued enums (`NO_DEVICE = "NO_DEVICE"`) rather than numeric enums. String enums produce readable values when logged or serialized — `"NO_DEVICE"` instead of `0`. This matters because error codes appear in CLI output and debug logs.

### Template Substitution Design
Several error messages contain placeholders (`{serial}`, `{exception}`, `{path}`, `{size}`, `{ms}`). The `InjectionError` constructor accepts an optional `context: Record<string, string>` parameter. When provided, each `{key}` in the message template is replaced with the corresponding value. This keeps `ERROR_META` immutable while allowing context-specific messages.

### No `process.stderr.write` vs `console.error` Decision
The `debug` method should use `process.stderr.write` (not `console.error`) because `console.error` adds its own formatting and newline handling that may interfere with the timestamp prefix format. For `error`, `console.error` is acceptable since its formatting is standard. Be consistent: pick one approach per output target and document it.

## Wave Structure
Wave 1: [Task 1, Task 2] — `errors.ts` and `logger.ts` are separate files with a unidirectional dependency (logger imports from errors). Task 1 must complete first since Task 2 imports `ErrorCode` and `ERROR_META`. Sequential within Wave 1.

Wave 2: [Task 3, Task 4] — Test files for errors and logger. Independent files, no shared state, no shared test fixtures. Task 3 tests `errors.ts` only. Task 4 tests `logger.ts` only. **These can run in parallel** since they modify no shared files and have no runtime dependencies on each other.

Wave 3: [Task 5] — Verification pass. Depends on all source and test files from Waves 1-2. Sequential after Wave 2.

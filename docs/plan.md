---
status: complete
feature: injection-tool
created: 2026-03-11T11:30:00.000Z
phase: 4
---
# Plan: MWA Standard Wallet Injection Tool

## Decomposition Strategy

**PD-1: Two-Subsystem Split (Payload-First)** [LOCKED]
- Alternatives: Vertical Flow (blurs subsystem boundary), Component-Layered (over-structured for tool this size)
- Rationale: Mirrors architecture's two-subsystem boundary (CLI + Payload). Payload is independently valuable after Wave 2 (manual paste fallback works). CLI builds on the payload artifact — natural dependency flow. 7 stories is right-sized.

### Architecture Amendment

**A-1: Inject-before-load as primary strategy** — `Page.addScriptToEvaluateOnNewDocument` + `Page.reload` replaces `Runtime.evaluate` as primary injection method. `Runtime.evaluate` becomes fallback (`--no-reload` flag). See `docs/amendments.md`.

---

## Epic 1: Project Foundation & Injection Payload

### Story 1-1: Project Setup & Payload Constants/Guard [S]
**User Story:** As a QA Engineer, I want the project scaffolded with TypeScript, esbuild, and the injection payload's guard logic, so that the foundation exists for building the IIFE payload.
**Dependencies:** None
**Wave:** 1

**Acceptance Criteria:**
- AC-1: Given a fresh clone, When `npm install` runs, Then all dependencies install without errors and `package.json` includes `engines: { "node": ">=18" }`, `scripts` for `build`, `test`, `lint`, and `format`
- AC-2: Given the project is set up, When `tsconfig.json` is inspected, Then `strict: true` is enabled
- AC-3: Given `src/payload/constants.ts` exists, When imported, Then it exports `INJECTED_FLAG = '__MWA_INJECTED__'`, `LOG_PREFIX = '[MWA Inject]'`, `CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet']`, `CDP_TIMEOUT = 10_000`, `ADB_TIMEOUT = 15_000`
- AC-4: Given `src/payload/guard.ts` exists, When `guard()` is called with `window.__MWA_INJECTED__ === true`, Then it returns `{ canInject: false, reason: "already_injected" }`
- AC-5: Given a non-Android user agent, When `guard()` is called, Then it returns `{ canInject: false, reason: "not_android" }`
- AC-6: Given `window.isSecureContext === false`, When `guard()` is called, Then it returns `{ canInject: false, reason: "not_secure_context" }`
- AC-7: Given Android UA + HTTPS + no prior injection, When `guard()` is called, Then it returns `{ canInject: true }`
- AC-8: Given the project, When `npm run lint` and `npm run format` are run, Then ESLint (`@typescript-eslint/recommended`) and Prettier execute without errors on source files

**FR Coverage:** FR-4, FR-9
**NFR Coverage:** NFR-4, AC-D-8

---

### Story 1-2: Payload Config, Registration & IIFE Build [M]
**User Story:** As a QA Engineer, I want the injection payload to derive app identity from the page context, call `registerMwa()`, and be built as a self-contained IIFE bundle, so that the CLI can deliver it to any dApp page via CDP.
**Dependencies:** 1-1
**Wave:** 2

**Acceptance Criteria:**
- AC-1: Given `src/payload/config.ts` exists, When `buildConfig()` is called on a page with `document.title = "Jupiter"` and `location.origin = "https://jup.ag"`, Then it returns `{ appIdentity: { name: "Jupiter", uri: "https://jup.ag" }, chains: ["solana:mainnet", "solana:devnet", "solana:testnet"] }`
- AC-2: Given a page with `<link rel="icon" href="/favicon.png">`, When `buildConfig()` is called, Then `appIdentity.icon` is `"https://jup.ag/favicon.png"`
- AC-3: Given no favicon link element and no `/favicon.ico`, When `buildConfig()` is called, Then `appIdentity.icon` is `undefined`
- AC-4: Given `src/payload/index.ts` exists, When the IIFE executes in a valid environment (Android, HTTPS, not injected), Then it calls `registerMwa()` with the derived config, sets `window.__MWA_INJECTED__ = true`, logs `"[MWA Inject] Wallet registered successfully"`, and returns `{ success: true, reason: "registered" }`
- AC-5: Given the IIFE executes in an invalid environment, When guard returns `canInject: false`, Then it logs `"[MWA Inject] Skipped: {reason}"` and returns `{ success: false, reason: "{guard_reason}" }`
- AC-6: Given `npm run build` completes, Then `dist/mwa-inject.min.js` (minified IIFE) and `dist/mwa-inject.js` (debug, readable names) both exist
- AC-7: Given `dist/mwa-inject.min.js` exists, When its file size is checked, Then it is < 150,000 bytes; if it exceeds 150,000 bytes the build fails with exit code 1

**FR Coverage:** FR-2, FR-10, FR-11, FR-13
**NFR Coverage:** NFR-1, NFR-5

---

## Epic 2: CLI & Automated Delivery

### Story 2-1: Error Catalog & Logger [S]
**User Story:** As a QA Engineer, I want all CLI failure modes defined in a single error catalog with clear messages and remediation hints, so that when something fails I know exactly what went wrong and how to fix it.
**Dependencies:** 1-1
**Wave:** 2

**Acceptance Criteria:**
- AC-1: Given `src/cli/errors.ts` exists, When inspected, Then it exports `enum ErrorCode` with values: `NO_DEVICE`, `DEVICE_NOT_FOUND`, `PORT_FORWARD_FAILED`, `NO_TABS`, `TAB_CONNECT_FAILED`, `PAYLOAD_EXCEPTION`, `PAYLOAD_NOT_FOUND`, `VERIFY_FAILED`, `BUNDLE_TOO_LARGE`, `TIMEOUT`
- AC-2: Given `ErrorCode`, When `ERROR_META[code]` is accessed, Then it returns `{ message: string, remediation: string, retryable: boolean }` for every enum member
- AC-3: Given `src/cli/errors.ts`, When `new InjectionError(ErrorCode.NO_DEVICE)` is constructed, Then `error.code === ErrorCode.NO_DEVICE`, `error.message` matches `ERROR_META[NO_DEVICE].message`, and `error instanceof Error === true`
- AC-4: Given `src/cli/logger.ts` exists, When `createLogger({ verbose: false })` is called, Then the returned logger has methods `info(msg)`, `success(msg)`, `error(code, msg)`, `debug(msg)` where `debug` is a no-op in non-verbose mode
- AC-5: Given `createLogger({ verbose: true })`, When `debug(msg)` is called, Then it writes to stderr with a timestamp prefix
- AC-6: Given all error codes, When each is mapped to a user-facing message, Then every `ErrorCode` has a unique message containing the step name and a remediation hint

**FR Coverage:** FR-8
**NFR Coverage:** AC-D-2, AC-D-7

---

### Story 2-2: Device Detection & CDP Connection [M]
**User Story:** As a QA Engineer, I want the CLI to automatically detect my Android device and set up a CDP connection to Chrome, so that I don't have to manually run `adb` commands.
**Dependencies:** 2-1
**Wave:** 3

**Acceptance Criteria:**
- AC-1: Given `src/cli/device.ts` with `createDeviceManager(deps: { exec: ExecFn }): DeviceManager`, When `detectDevices()` is called and `adb devices` returns one device line, Then it returns `[{ serial: "emulator-5554", type: "emulator", model: "sdk_gphone64_arm64" }]`
- AC-2: Given `adb devices` returns zero device lines, When `detectDevices()` is called, Then it throws `InjectionError` with code `NO_DEVICE`
- AC-3: Given multiple devices and `--device emulator-5554` flag, When `selectDevice(devices, "emulator-5554")` is called, Then it returns the matching device
- AC-4: Given `--device unknown-serial` flag, When `selectDevice()` is called, Then it throws `InjectionError` with code `DEVICE_NOT_FOUND`
- AC-5: Given `src/cli/cdp.ts` with `createCDP(deps: { exec, http, WebSocket }): CDPClient`, When `forwardCDP(device)` is called, Then it runs `adb -s {serial} forward tcp:0 localabstract:chrome_devtools_remote`, parses the ephemeral port, and returns a `CDPConnection`
- AC-6: Given `adb forward` fails, When `forwardCDP()` is called, Then it throws `InjectionError` with code `PORT_FORWARD_FAILED`
- AC-7: Given a `CDPConnection`, When `discoverTabs(conn)` is called, Then it first checks `/json/version` for the focused tab's WebSocket URL, then falls back to HTTP GET `/json`, filters for `type === "page"`, and returns `Tab[]`
- AC-8: Given `/json` returns zero page-type tabs after 3 retries with exponential backoff, When `discoverTabs()` is called, Then it throws `InjectionError` with code `NO_TABS`
- AC-9: Given a valid `CDPConnection`, When `cleanup(conn)` is called, Then it runs `execSync('adb -s {serial} forward --remove tcp:{port}')` synchronously
- AC-10: Given a `CDPClient`, When `registerScript(tab, scriptSource)` is called, Then it sends `{ method: "Page.addScriptToEvaluateOnNewDocument", params: { source: scriptSource } }` via CDP WebSocket and returns the script identifier
- AC-11: Given a `CDPClient`, When `reloadPage(tab)` is called, Then it sends `{ method: "Page.reload" }` via CDP WebSocket and waits for `Page.loadEventFired` before returning

**FR Coverage:** FR-5, FR-6, FR-7
**NFR Coverage:** NFR-3, AC-A-1, AC-A-2, AC-A-3

---

### Story 2-3: CLI Orchestration & Payload Delivery [M]
**User Story:** As a QA Engineer, I want to run a single command that detects my device, connects to Chrome, injects the payload before page scripts load, and confirms success, so that I can test MWA on any dApp without manual steps.
**Dependencies:** 1-2, 2-2
**Wave:** 4

**Acceptance Criteria:**
- AC-1: Given `src/cli/index.ts` with `main(): Promise<void>`, When executed with a single connected device and Chrome open on a Solana dApp (default mode), Then it executes: detectDevices → forwardCDP → discoverTabs → registerScript (payload via `Page.addScriptToEvaluateOnNewDocument`) → reloadPage → wait for load → verify `window.__MWA_INJECTED__` → cleanup, and exits with code 0
- AC-2: Given the default injection mode, When `registerScript` and `reloadPage` complete, Then the payload has executed before the dApp's JavaScript, and the MWA wallet is present when the dApp's wallet adapter initializes
- AC-3: Given `--no-reload` flag, When executed, Then the CLI falls back to `Runtime.evaluate` (late injection) without reloading the page — for cases where the user wants to preserve page state
- AC-4: Given the verification probe (`Runtime.evaluate("window.__MWA_INJECTED__")`) returns `true` after reload, When processed, Then the CLI logs `"✓ Wallet registration confirmed"`
- AC-5: Given `Runtime.evaluate` returns `exceptionDetails` (in `--no-reload` mode), When the CLI processes the response, Then it throws `InjectionError` with code `PAYLOAD_EXCEPTION` including the exception text
- AC-6: Given `Runtime.evaluate` returns `{ result: { value: { success: false, reason: "not_android" } } }`, When the CLI processes the response, Then it maps the `GuardReason` to a user-facing message via `Record<GuardReason, string>` and exits with code 1
- AC-7: Given the CLI is running and receives SIGINT, When the signal handler fires, Then `cleanup()` runs synchronously via `execSync` before the process exits
- AC-8: Given `dist/mwa-inject.min.js` does not exist, When `main()` tries to read it, Then it throws `InjectionError` with code `PAYLOAD_NOT_FOUND`
- AC-9: Given `--verbose` flag, When the CLI runs, Then debug-level logs (ADB commands, CDP messages, injection mode, tab selection heuristic) are written to stderr
- AC-10: Given the CLI logs tab selection, When multiple tabs exist, Then it prints the selected tab's URL and title and the heuristic used
- AC-11: Given `scripts/inject.sh` exists, When executed with `--device emulator-5554 --verbose`, Then it delegates to `node dist/cli.js --device emulator-5554 --verbose`

**FR Coverage:** FR-1, FR-8
**NFR Coverage:** AC-A-4, AC-U-1, AC-U-4, AC-U-7

---

## Epic 3: Verification & Documentation

### Story 3-1: Test dApp HTML Page [S]
**User Story:** As a QA Engineer, I want a test HTML page that displays registered wallets, so that I can verify the injection works in a controlled environment before testing on production dApps.
**Dependencies:** 1-2
**Wave:** 3

**Acceptance Criteria:**
- AC-1: Given `test/test-dapp.html` exists, When opened in a browser, Then it listens for `wallet-standard:register-wallet` events and displays each registered wallet's name in a visible list
- AC-2: Given the test page is open on an Android device over HTTPS, When the injection script is run, Then "MWA" (or the wallet's registered name) appears in the wallet list without a page reload
- AC-3: Given the test page is open over HTTP, When the payload is injected, Then the page shows the guard's `"not_secure_context"` skip reason (via console output visible to the user)

**FR Coverage:** FR-12, FR-3
**NFR Coverage:** NFR-2

---

### Story 3-2: README & Shell Wrapper [S]
**User Story:** As a QA Engineer, I want a README with quick-start instructions, CSP troubleshooting, and a convenient shell wrapper script, so that I can get started quickly and diagnose issues.
**Dependencies:** 2-3
**Wave:** 5

**Acceptance Criteria:**
- AC-1: Given `README.md` exists, When read, Then it contains: prerequisites (Node 18+, adb, USB debugging), quick-start (install, build, run `./scripts/inject.sh`), usage examples with `--device`, `--verbose`, and `--no-reload` flags
- AC-2: Given `README.md`, When the injection modes section is read, Then it explains the default inject-before-load strategy (script registered + page reload) and the `--no-reload` fallback (late injection via `Runtime.evaluate`), including when to use each
- AC-3: Given `README.md`, When the CSP section is read, Then it explains how CSP can block `ws://localhost:*`, how to identify CSP errors in DevTools, and states this is a known limitation not specific to injection
- AC-4: Given `README.md`, When the test page section is read, Then it includes step-by-step instructions for serving `test-dapp.html` over HTTPS on the Android device
- AC-5: Given `scripts/inject.sh` exists and is executable, When run with `./scripts/inject.sh --help`, Then it delegates to `node dist/cli.js --help` and prints usage information

**FR Coverage:** FR-3, FR-12
**NFR Coverage:** AC-U-3, AC-U-6

---

## FR Coverage Map

| FR | Requirement | Stories | Status |
|----|-------------|---------|--------|
| FR-1 | [QA Engineer] can [run a single CLI command to inject the MWA wallet] | 2-3 | ✅ Covered |
| FR-2 | [QA Engineer] can [see the MWA wallet appear in the dApp's wallet picker] | 1-2 | ✅ Covered |
| FR-3 | [QA Engineer] can [complete the MWA connect flow through the injected wallet] | 3-1, 3-2 | ✅ Covered |
| FR-4 | [QA Engineer] can [run the injection multiple times without duplicates] | 1-1 | ✅ Covered |
| FR-5 | [QA Engineer] can [have the script automatically detect connected devices] | 2-2 | ✅ Covered |
| FR-6 | [QA Engineer] can [have the script automatically discover the active Chrome tab] | 2-2 | ✅ Covered |
| FR-7 | [QA Engineer] can [select a specific device when multiple are connected] | 2-2 | ✅ Covered |
| FR-8 | [QA Engineer] can [see terminal output confirming success or failure] | 2-1, 2-3 | ✅ Covered |
| FR-9 | [QA Engineer] can [use the injection on any Solana chain] | 1-1 | ✅ Covered |
| FR-10 | [QA Engineer] can [inject with app identity derived from the page] | 1-2 | ✅ Covered |
| FR-11 | [QA Engineer] can [build the payload in minified and debug variants] | 1-2 | ✅ Covered |
| FR-12 | [QA Engineer] can [verify wallet registration using a test HTML page] | 3-1, 3-2 | ✅ Covered |
| FR-13 | [QA Engineer] can [manually paste the payload as a fallback] | 1-2 | ✅ Covered |

**Coverage: 13/13 (100%)**

## NFR Coverage Strategy

| NFR | Requirement | Path | Story |
|-----|-------------|------|-------|
| NFR-1 | Bundle < 150KB | Direct | 1-2 |
| NFR-2 | Chrome 100+ | Cross-cutting | 3-1 (verified) |
| NFR-3 | Physical + emulator | Direct | 2-2 |
| NFR-4 | Node.js >= 18 | Direct | 1-1 |
| NFR-5 | Single file, zero deps | Direct | 1-2 |

**Coverage: 5/5 — 4 Direct, 1 Cross-cutting, 0 Deferred**

## Dependency Graph

```
1-1 (Project Setup & Guard)
 ├──→ 1-2 (Payload Config & Build)
 │     ├──→ 2-3 (CLI Orchestration) ──→ 3-2 (README & Shell Wrapper)
 │     └──→ 3-1 (Test dApp Page)
 └──→ 2-1 (Error Catalog & Logger)
       └──→ 2-2 (Device Detection & CDP)
             └──→ 2-3 (CLI Orchestration)
```

## Wave Assignments

| Wave | Stories | Rationale |
|------|---------|-----------|
| 1 | 1-1 | Foundation — no deps |
| 2 | 1-2, 2-1 | Independent subsystems (payload vs CLI errors) |
| 3 | 2-2, 3-1 | Independent (CLI device/CDP vs test page) |
| 4 | 2-3 | Orchestration — needs payload + device/CDP |
| 5 | 3-2 | Docs — needs complete CLI |

## Interface Contracts

### GuardResult / GuardReason
- **Defined by:** Story 1-1
- **Consumed by:** Story 1-2 (payload index), Story 2-3 (CLI maps GuardReason to messages)
- **Signature:** `guard(): GuardResult` where `type GuardReason = "already_injected" | "not_android" | "not_secure_context"` and `interface GuardResult { canInject: boolean; reason?: GuardReason }`
- **Location:** `src/payload/guard.ts`

### RegisterMwaConfig / buildConfig
- **Defined by:** Story 1-2
- **Consumed by:** Story 1-2 (payload index calls registerMwa with config)
- **Signature:** `buildConfig(): RegisterMwaConfig`
- **Location:** `src/payload/config.ts`

### InjectionError / ErrorCode / ERROR_META
- **Defined by:** Story 2-1
- **Consumed by:** Story 2-2 (device/CDP throw errors), Story 2-3 (orchestrator catches errors)
- **Signature:** `enum ErrorCode { NO_DEVICE, DEVICE_NOT_FOUND, ... }`, `class InjectionError extends Error { code: ErrorCode }`, `ERROR_META: Record<ErrorCode, { message: string, remediation: string, retryable: boolean }>`
- **Location:** `src/cli/errors.ts`

### DeviceManager
- **Defined by:** Story 2-2
- **Consumed by:** Story 2-3 (orchestrator calls detectDevices/selectDevice)
- **Signature:** `createDeviceManager(deps: { exec: ExecFn }): DeviceManager` with `detectDevices(): Device[]`, `selectDevice(devices: Device[], serial?: string): Device`
- **Location:** `src/cli/device.ts`

### CDPClient
- **Defined by:** Story 2-2
- **Consumed by:** Story 2-3 (orchestrator calls full pipeline)
- **Signature:** `createCDP(deps: { exec: ExecFn, http: HttpModule, WebSocket: WSConstructor }): CDPClient` with `forwardCDP(device: Device): CDPConnection`, `discoverTabs(conn: CDPConnection): Tab[]`, `registerScript(tab: Tab, source: string): string`, `reloadPage(tab: Tab): Promise<void>`, `evaluatePayload(tab: Tab, payload: string): EvalResult`, `cleanup(conn: CDPConnection): void`
- **Location:** `src/cli/cdp.ts`

### Logger
- **Defined by:** Story 2-1
- **Consumed by:** Story 2-2, Story 2-3
- **Signature:** `createLogger(opts: { verbose: boolean }): Logger` with `info(msg: string): void`, `success(msg: string): void`, `error(code: ErrorCode, msg: string): void`, `debug(msg: string): void`
- **Location:** `src/cli/logger.ts`

## Plan Decisions

**PD-1:** Two-Subsystem Split (Payload-First) decomposition strategy [LOCKED]
- Alternatives: Vertical Flow (blurs boundary), Component-Layered (over-structured)
- Rationale: Mirrors architecture. Payload independently valuable. Clean dependency flow.

**PD-2:** Inject-before-load as primary strategy, Runtime.evaluate as fallback [LOCKED]
- Alternatives: Runtime.evaluate only (original architecture), always reload (no fallback)
- Rationale: Real-world testing showed dApps snapshot wallets at mount time. `Page.addScriptToEvaluateOnNewDocument` + `Page.reload` guarantees wallet is registered before dApp JS runs. `--no-reload` flag preserves the late-injection option. Documented in `docs/amendments.md` A-1.

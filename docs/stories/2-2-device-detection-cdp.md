---
id: "2-2-device-detection-cdp"
status: ready
created: 2026-03-11
---

# Story: Device Detection & CDP Connection

## User Story
As a QA Engineer, I want the CLI to automatically detect my Android device and set up a CDP connection to Chrome, so that I don't have to manually run `adb` commands.

## Acceptance Criteria
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

## Architecture Guardrails

### Design Decisions
- **DD-7 (LOCKED):** CDP for automated payload delivery
- **DD-8 (LOCKED):** CLI in Node.js TypeScript, not shell script
- **DD-9 (LOCKED):** Separate `src/cli/` and `src/payload/` directories. CLI targets Node.js; payload targets browser. They share no code at runtime.
- **DD-11 (DISCRETION):** Tab selection heuristic -- check `/json/version` for focused tab's WebSocket URL first, fall back to first "page" type from `/json`. CDP `/json/version` returns the currently focused tab's WebSocket URL when available. Falls back to first page-type tab if `/json/version` lacks the info.
- **DD-13 (DISCRETION):** `ws` npm package for CDP WebSocket. Battle-tested, lightweight (~50 KB). Node.js native WebSocket available in 22+ but project targets Node 18+.

### Amendment A-1: Inject-Before-Load as Primary Strategy
Primary injection strategy uses `Page.addScriptToEvaluateOnNewDocument` to register the payload for execution before page scripts, followed by `Page.reload`. This ensures `registerMwa()` runs before the dApp's wallet adapter initializes. `Runtime.evaluate` becomes a fallback for cases where reload is undesirable (Story 2-3 handles the `--no-reload` flag).

**Impact on this story:** This story must implement `registerScript(tab, source)` which sends `Page.addScriptToEvaluateOnNewDocument` (AC-10) and `reloadPage(tab)` which sends `Page.reload` and waits for `Page.loadEventFired` (AC-11). The `evaluatePayload()` method is still defined on `CDPClient` for the fallback path but is implemented in Story 2-3.

### Project Structure

```
src/cli/
├── index.ts          # Entry point — orchestrates pipeline (Story 2-3)
├── device.ts         # ADB device detection + selection (THIS story)
├── cdp.ts            # CDP port forwarding, tab discovery, script injection (THIS story)
├── errors.ts         # Error catalog — all failure codes/messages (Story 2-1, EXISTS)
└── logger.ts         # Structured logging with --verbose support (Story 2-1, EXISTS)
```

### Component: cli/device.ts

- **Responsibility:** List devices via `adb devices`, parse output, select device by serial
- **Interface:** Factory function `createDeviceManager(deps: { exec: ExecFn }): DeviceManager`
- **Methods:**
  - `detectDevices(): Device[]` -- Run `adb devices`, parse output lines, enrich with model from `adb shell getprop ro.product.model`. Throws `InjectionError(NO_DEVICE)` if zero devices found.
  - `selectDevice(devices: Device[], serial?: string): Device` -- If serial provided, find matching device or throw `InjectionError(DEVICE_NOT_FOUND, { serial })`. If no serial and single device, return it. If multiple devices and no serial, throw (orchestrator in Story 2-3 will handle prompting).

### Component: cli/cdp.ts

- **Responsibility:** Set up `adb forward` (ephemeral port), discover tabs via CDP HTTP endpoints, send CDP commands via WebSocket, cleanup port forwards
- **Interface:** Factory function `createCDP(deps: { exec: ExecFn, http: HttpModule, WebSocket: WSConstructor }): CDPClient`
- **Methods:**
  - `forwardCDP(device: Device): CDPConnection` -- Run `adb -s <serial> forward tcp:0 localabstract:chrome_devtools_remote`, parse ephemeral port from stdout. Returns `CDPConnection`. Throws `InjectionError(PORT_FORWARD_FAILED)` on failure.
  - `discoverTabs(conn: CDPConnection): Promise<Tab[]>` -- First HTTP GET `http://localhost:<port>/json/version` to check for focused tab WebSocket URL. If found, construct a Tab for it. If not, HTTP GET `http://localhost:<port>/json`, filter `type === "page"`. Retry 3x with exponential backoff (delays: 500ms, 1000ms, 2000ms). Throws `InjectionError(NO_TABS)` after exhausting retries.
  - `registerScript(tab: Tab, source: string): Promise<string>` -- Open WebSocket to `tab.webSocketDebuggerUrl`, send `{ method: "Page.addScriptToEvaluateOnNewDocument", params: { source } }`, return the `identifier` from the CDP response. Amended by A-1: this is the primary injection method.
  - `reloadPage(tab: Tab): Promise<void>` -- Send `{ method: "Page.reload" }` via WebSocket, then wait for `Page.loadEventFired` event before resolving. Amended by A-1: used after `registerScript` to trigger the injected script.
  - `cleanup(conn: CDPConnection): void` -- Synchronously run `execSync('adb -s <serial> forward --remove tcp:<port>')`. Must be synchronous for use in signal handlers and `process.on('exit')`.

### Dependency Injection Pattern

Both modules use factory functions accepting their dependencies as parameters, enabling testing without real ADB or CDP:

```typescript
// ExecFn wraps execSync with string encoding
type ExecFn = (command: string) => string;

// HttpModule matches Node.js http.get signature subset
type HttpModule = {
  get(url: string, callback: (res: IncomingMessage) => void): void;
};

// WSConstructor matches the ws package constructor
type WSConstructor = new (url: string) => WebSocketLike;

interface WebSocketLike {
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  send(data: string): void;
  close(): void;
}
```

### Data Models

```typescript
interface Device {
  serial: string;      // e.g., "emulator-5554" or "HVA7N18A14000257"
  type: "device" | "emulator";
  model: string;       // from `adb shell getprop ro.product.model`
}

interface CDPConnection {
  device: Device;
  localPort: number;     // ephemeral port bound by adb forward
  wsEndpoint: string;    // WebSocket URL for CDP commands
}

interface Tab {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  type: "page" | "background_page" | "service_worker";
}
```

### Error Codes Used by This Story

| Code | When Thrown | Context Params |
|------|-----------|----------------|
| `NO_DEVICE` | `detectDevices()` finds zero devices | none |
| `DEVICE_NOT_FOUND` | `selectDevice()` cannot match serial | `{ serial }` |
| `PORT_FORWARD_FAILED` | `forwardCDP()` adb forward command fails | none |
| `NO_TABS` | `discoverTabs()` finds zero page tabs after retries | none |
| `TAB_CONNECT_FAILED` | WebSocket connection to tab fails | none |
| `TIMEOUT` | CDP or ADB operation exceeds timeout | `{ ms }` |

### Error Propagation Pattern

```
cli/device.ts  ──throws InjectionError──┐
cli/cdp.ts     ──throws InjectionError──┤
                                        ▼
cli/index.ts   ──catches──→ logger.error(code, message)
                          → cleanup (always runs)
                          → process.exit(1)
```

All errors in the CLI subsystem are `InjectionError` instances with an `ErrorCode` enum value. This story throws errors; Story 2-3 (orchestrator) catches them.

### CDP Port Security (AC-A-1, AC-A-2, AC-A-3)

- **Ephemeral port (AC-A-3):** `adb forward tcp:0` lets the OS assign a random available port, not a fixed/predictable port
- **Localhost only (AC-A-2):** `adb forward` binds to 127.0.0.1 by default -- not externally accessible
- **Teardown on exit (AC-A-1):** `cleanup()` uses synchronous `execSync` so it can run in signal handlers (SIGINT, SIGTERM) and `process.on('exit')` to guarantee port forward removal before process exits

### ADB Output Parsing

**`adb devices` output format:**
```
List of devices attached
emulator-5554	device
HVA7N18A14000257	device

```

- First line is always the header: `List of devices attached`
- Each subsequent non-empty line is: `<serial>\t<state>` where state is `device`, `offline`, or `unauthorized`
- Only include devices with state `device` (skip `offline` and `unauthorized`)
- Determine `type` field: if serial starts with `emulator-`, type is `"emulator"`, otherwise `"device"`
- Get model: run `adb -s <serial> shell getprop ro.product.model` for each device, trim whitespace

**`adb forward` output format:**
```
12345
```
- Output is the ephemeral port number as a string, followed by a newline
- Parse with `parseInt(output.trim(), 10)`

### CDP HTTP Response Formats

**`/json/version` response:**
```json
{
  "Browser": "Chrome/120.0.6099.210",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/..."
}
```
- The `webSocketDebuggerUrl` field may or may not be present
- When present, it points to the browser-level debugger, not a specific tab
- For DD-11: check if this response contains a usable WebSocket URL for the focused tab

**`/json` response:**
```json
[
  {
    "id": "ABC123",
    "title": "Jupiter Exchange",
    "url": "https://jup.ag",
    "webSocketDebuggerUrl": "ws://localhost:12345/devtools/page/ABC123",
    "type": "page"
  },
  {
    "id": "DEF456",
    "title": "Service Worker",
    "url": "chrome-extension://...",
    "webSocketDebuggerUrl": "ws://localhost:12345/devtools/page/DEF456",
    "type": "service_worker"
  }
]
```
- Filter for entries where `type === "page"`
- Each entry has `id`, `title`, `url`, `webSocketDebuggerUrl`, `type`

### CDP WebSocket Protocol

CDP messages use JSON-RPC style with incrementing `id` fields:

**Sending a command:**
```json
{ "id": 1, "method": "Page.addScriptToEvaluateOnNewDocument", "params": { "source": "..." } }
```

**Receiving a response:**
```json
{ "id": 1, "result": { "identifier": "script-id-123" } }
```

**Receiving an event (no id, method field instead):**
```json
{ "method": "Page.loadEventFired", "params": { "timestamp": 1234567890.123 } }
```

- Use incrementing `id` to correlate requests with responses
- Events have `method` field but no `id` field
- `registerScript` waits for response with matching `id`, extracts `result.identifier`
- `reloadPage` sends `Page.reload`, then listens for `Page.loadEventFired` event

### Timeouts

From `src/payload/constants.ts`:
- `CDP_TIMEOUT = 10_000` (10 seconds) -- timeout for CDP WebSocket operations
- `ADB_TIMEOUT = 15_000` (15 seconds) -- timeout for ADB commands

Import these constants from `../payload/constants.js` or define local constants. Since the payload and CLI share no code at runtime, prefer defining CLI-specific timeout constants locally in the CLI modules. However, the constants file is available at build time and the architecture defines them there.

**Decision:** Define timeout constants locally in `cdp.ts` and `device.ts` to maintain the subsystem boundary. Use the same values: `CDP_TIMEOUT = 10_000`, `ADB_TIMEOUT = 15_000`.

## Verified Interfaces

### ErrorCode (from Story 2-1)
- **Source:** `src/cli/errors.ts:1-12`
- **Signature:** `export enum ErrorCode { NO_DEVICE = "NO_DEVICE", DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND", PORT_FORWARD_FAILED = "PORT_FORWARD_FAILED", NO_TABS = "NO_TABS", TAB_CONNECT_FAILED = "TAB_CONNECT_FAILED", PAYLOAD_EXCEPTION = "PAYLOAD_EXCEPTION", PAYLOAD_NOT_FOUND = "PAYLOAD_NOT_FOUND", VERIFY_FAILED = "VERIFY_FAILED", BUNDLE_TOO_LARGE = "BUNDLE_TOO_LARGE", TIMEOUT = "TIMEOUT" }`
- **Plan match:** Matches

### InjectionError (from Story 2-1)
- **Source:** `src/cli/errors.ts:75-90`
- **Signature:** `export class InjectionError extends Error { readonly code: ErrorCode; constructor(code: ErrorCode, context?: Record<string, string>) }`
- **Plan match:** Matches

### ErrorMeta (from Story 2-1)
- **Source:** `src/cli/errors.ts:14-18`
- **Signature:** `export interface ErrorMeta { message: string; remediation: string; retryable: boolean; }`
- **Plan match:** Matches

### ERROR_META (from Story 2-1)
- **Source:** `src/cli/errors.ts:20-73`
- **Signature:** `export const ERROR_META: Record<ErrorCode, ErrorMeta>`
- **Plan match:** Matches

### Logger (from Story 2-1)
- **Source:** `src/cli/logger.ts:3-8`
- **Signature:** `export interface Logger { info(msg: string): void; success(msg: string): void; error(code: ErrorCode, msg: string): void; debug(msg: string): void; }`
- **Plan match:** Matches

### createLogger (from Story 2-1)
- **Source:** `src/cli/logger.ts:10-33`
- **Signature:** `export function createLogger(opts: { verbose: boolean }): Logger`
- **Plan match:** Matches

## Tasks
- [x] Task 1: Install `ws` package and `@types/ws` as dependencies
  - Maps to: AC-5, AC-10, AC-11 (required for CDP WebSocket communication)
  - Files: `package.json` (modified)
  - Details:
    - `npm install ws@^8.19.0` as a production dependency (used by CLI at runtime)
    - `npm install -D @types/ws@^8.18.1` as a dev dependency (TypeScript types)
    - The `ws` package provides the WebSocket client for CDP communication
    - DD-13 mandates `ws` over native WebSocket (Node 18+ target)

- [x] Task 2: Create `src/cli/device.ts` with `createDeviceManager` factory, `detectDevices`, and `selectDevice`
  - Maps to: AC-1, AC-2, AC-3, AC-4
  - Files: `src/cli/device.ts` (created)
  - Details:
    - Export types: `ExecFn = (command: string) => string`, `Device`, `DeviceManager`
    - Export `createDeviceManager(deps: { exec: ExecFn }): DeviceManager`
    - `detectDevices()`:
      1. Run `deps.exec("adb devices")` -- get stdout string
      2. Split by `\n`, skip first line ("List of devices attached"), filter empty lines
      3. Parse each line: split by `\t` -> `[serial, state]`
      4. Filter: only include lines where state is `"device"` (skip `offline`, `unauthorized`)
      5. For each: determine type (`serial.startsWith("emulator-") ? "emulator" : "device"`)
      6. For each: get model via `deps.exec(\`adb -s ${serial} shell getprop ro.product.model\`).trim()`
      7. If 0 devices: `throw new InjectionError(ErrorCode.NO_DEVICE)`
      8. Return `Device[]`
    - `selectDevice(devices: Device[], serial?: string): Device`:
      1. If no serial and single device: return `devices[0]`
      2. If serial: find device where `device.serial === serial`
      3. If not found: `throw new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial })`
      4. Return matching device
    - Import `InjectionError`, `ErrorCode` from `./errors.js`
    - Define `ADB_TIMEOUT = 15_000` locally (not imported from payload)

- [x] Task 3: Create `src/cli/cdp.ts` with `createCDP` factory and all CDP methods
  - Maps to: AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11
  - Files: `src/cli/cdp.ts` (created)
  - Details:
    - Export types: `CDPConnection`, `Tab`, `CDPClient`, `HttpModule`, `WSConstructor`
    - Export `createCDP(deps: { exec: ExecFn, http: HttpModule, WebSocket: WSConstructor }): CDPClient`
    - Define `CDP_TIMEOUT = 10_000` locally
    - **`forwardCDP(device: Device): CDPConnection`** (AC-5, AC-6):
      1. Run `deps.exec(\`adb -s ${device.serial} forward tcp:0 localabstract:chrome_devtools_remote\`)`
      2. Parse port: `parseInt(output.trim(), 10)`
      3. If NaN or exec throws: `throw new InjectionError(ErrorCode.PORT_FORWARD_FAILED)`
      4. Return `{ device, localPort: port, wsEndpoint: \`ws://localhost:${port}\` }`
    - **`discoverTabs(conn: CDPConnection): Promise<Tab[]>`** (AC-7, AC-8):
      1. First try: HTTP GET `http://localhost:${conn.localPort}/json/version`
         - Parse JSON response. If `webSocketDebuggerUrl` exists, construct a tab entry for it (DD-11).
      2. Fallback: HTTP GET `http://localhost:${conn.localPort}/json`
         - Parse JSON array. Filter entries where `type === "page"`.
      3. If zero page tabs: retry up to 3 times with exponential backoff (500ms, 1000ms, 2000ms)
      4. After all retries exhausted with zero results: `throw new InjectionError(ErrorCode.NO_TABS)`
      5. Return `Tab[]`
      - Use `deps.http.get()` for HTTP requests. Parse response body by collecting data chunks.
    - **`registerScript(tab: Tab, source: string): Promise<string>`** (AC-10):
      1. Open WebSocket via `new deps.WebSocket(tab.webSocketDebuggerUrl)`
      2. On `open`: send `JSON.stringify({ id: nextId++, method: "Page.addScriptToEvaluateOnNewDocument", params: { source } })`
      3. On `message`: parse JSON, match by `id`, extract `result.identifier`
      4. Return the identifier string
      5. On error/timeout: throw `InjectionError(TAB_CONNECT_FAILED)`
      6. Close WebSocket after receiving response
    - **`reloadPage(tab: Tab): Promise<void>`** (AC-11):
      1. Open WebSocket (or reuse existing) to `tab.webSocketDebuggerUrl`
      2. Send `{ id: nextId++, method: "Page.reload" }`
      3. Listen for event where `method === "Page.loadEventFired"` (events have no `id`)
      4. Resolve when `Page.loadEventFired` received
      5. Apply `CDP_TIMEOUT` -- reject with `InjectionError(TIMEOUT, { ms: "10000" })` if not received in time
    - **`cleanup(conn: CDPConnection): void`** (AC-9):
      1. Synchronous: `deps.exec(\`adb -s ${conn.device.serial} forward --remove tcp:${conn.localPort}\`)`
      2. Swallow errors silently (cleanup should not throw -- best-effort)
    - Use incrementing message IDs for CDP JSON-RPC correlation
    - Import `ExecFn` from `./device.js` (or re-export from a shared types location)

- [x] Task 4: Create `tests/cli/device.test.ts` with unit tests for device module
  - Maps to: AC-1, AC-2, AC-3, AC-4
  - Files: `tests/cli/device.test.ts` (created)
  - Details:
    - Use `// @vitest-environment node` directive (consistent with existing CLI tests)
    - Mock `exec` function using `vi.fn()` for all ADB commands
    - Test data: prepare mock `adb devices` output strings
    - Tests for `detectDevices()`:
      - Single device: `"List of devices attached\nemulator-5554\tdevice\n\n"` -> returns `[{ serial: "emulator-5554", type: "emulator", model: "sdk_gphone64_arm64" }]` (mock model query)
      - Zero devices: `"List of devices attached\n\n"` -> throws `InjectionError` with `NO_DEVICE`
      - Multiple devices: returns array with correct types and models
      - Offline device filtered: `"emulator-5554\toffline"` line is excluded
      - Unauthorized device filtered: `"HVA7N\tunauthorized"` line is excluded
      - Physical device type detection: serial `"HVA7N18A14000257"` -> `type: "device"`
    - Tests for `selectDevice()`:
      - Single device, no serial: returns the device
      - Matching serial: returns matching device
      - Unknown serial: throws `InjectionError` with `DEVICE_NOT_FOUND` and serial in message
      - Multiple devices, matching serial: returns correct one

- [x] Task 5: Create `tests/cli/cdp.test.ts` with unit tests for CDP module
  - Maps to: AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11
  - Files: `tests/cli/cdp.test.ts` (created)
  - Details:
    - Use `// @vitest-environment node` directive
    - Mock dependencies: `exec` as `vi.fn()`, `http` with mock `get` method, `WebSocket` as mock constructor
    - Create helper to build mock WebSocket instances with `on`, `send`, `close` methods
    - Create helper to build mock HTTP responses with data events
    - Tests for `forwardCDP()`:
      - Success: exec returns `"12345\n"` -> returns `CDPConnection` with `localPort: 12345`
      - Failure: exec throws -> throws `InjectionError` with `PORT_FORWARD_FAILED`
      - Parse error: exec returns non-numeric -> throws `InjectionError` with `PORT_FORWARD_FAILED`
    - Tests for `discoverTabs()`:
      - `/json/version` has `webSocketDebuggerUrl`: returns tab from version endpoint (DD-11)
      - `/json/version` lacks `webSocketDebuggerUrl`, `/json` has page tabs: returns filtered tabs
      - `/json` returns mixed types: only `type === "page"` included
      - Zero page tabs after retries: throws `InjectionError` with `NO_TABS`
      - Retry behavior: verify 3 retries with backoff before throwing
    - Tests for `registerScript()`:
      - Success: WebSocket sends `Page.addScriptToEvaluateOnNewDocument`, receives response with identifier
      - Verify the CDP message structure: `{ id, method: "Page.addScriptToEvaluateOnNewDocument", params: { source } }`
    - Tests for `reloadPage()`:
      - Success: sends `Page.reload`, resolves when `Page.loadEventFired` received
      - Timeout: no `Page.loadEventFired` within timeout -> rejects with TIMEOUT error
    - Tests for `cleanup()`:
      - Calls exec with correct `adb forward --remove` command
      - Does not throw when exec fails (swallows error)

- [x] Task 6: Update `vitest.config.ts` to use `environmentMatchGlobs` for CLI tests
  - Maps to: AC-1 through AC-11 (all -- ensures test environment is correct)
  - Files: `vitest.config.ts` (modified)
  - Details:
    - Add `environmentMatchGlobs` to centralize environment selection:
      ```typescript
      environmentMatchGlobs: [
        ["tests/payload/**", "jsdom"],
        ["tests/cli/**", "node"],
      ]
      ```
    - This replaces the need for `// @vitest-environment node` comments in CLI test files
    - Keep the `// @vitest-environment node` comments in existing test files for redundancy (they do not conflict)
    - NOTE: If existing CLI tests (errors.test.ts, logger.test.ts) already use the `// @vitest-environment node` comment and pass, this task is optional but recommended for consistency. Check if vitest.config.ts already has this -- if Story 2-1 already added it, skip this task.

- [x] Task 7: Verify lint, format, typecheck, and all tests pass
  - Maps to: AC-1 through AC-11 (all -- ensures code quality)
  - Files: none created, verification only
  - Details:
    - Run `npm run lint` -- ESLint passes on all new files
    - Run `npm run format` -- Prettier check passes
    - Run `npm run typecheck` -- TypeScript type-check passes
    - Run `npm test` -- all tests pass (existing + new)
    - Verify no regressions in existing payload and CLI tests

## must_haves
truths:
  - "createDeviceManager({ exec }).detectDevices() with adb output containing one device line returns [{ serial: 'emulator-5554', type: 'emulator', model: 'sdk_gphone64_arm64' }]"
  - "detectDevices() throws InjectionError with code NO_DEVICE when adb devices returns zero device lines"
  - "selectDevice(devices, 'emulator-5554') returns the device with matching serial from the devices array"
  - "selectDevice(devices, 'unknown-serial') throws InjectionError with code DEVICE_NOT_FOUND"
  - "forwardCDP(device) runs 'adb -s {serial} forward tcp:0 localabstract:chrome_devtools_remote' and returns CDPConnection with parsed ephemeral port"
  - "forwardCDP(device) throws InjectionError with code PORT_FORWARD_FAILED when adb forward fails"
  - "discoverTabs(conn) checks /json/version first for focused tab WebSocket URL, then falls back to /json filtered by type === 'page'"
  - "discoverTabs(conn) throws InjectionError with code NO_TABS after 3 retries with exponential backoff when no page tabs found"
  - "cleanup(conn) runs execSync('adb -s {serial} forward --remove tcp:{port}') synchronously"
  - "registerScript(tab, scriptSource) sends { method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: scriptSource } } via CDP WebSocket and returns the script identifier"
  - "reloadPage(tab) sends { method: 'Page.reload' } via CDP WebSocket and waits for Page.loadEventFired before returning"
artifacts:
  - path: "src/cli/device.ts"
    contains: ["createDeviceManager", "DeviceManager", "detectDevices", "selectDevice", "Device", "ExecFn", "adb devices", "InjectionError", "ErrorCode", "NO_DEVICE", "DEVICE_NOT_FOUND"]
  - path: "src/cli/cdp.ts"
    contains: ["createCDP", "CDPClient", "CDPConnection", "Tab", "forwardCDP", "discoverTabs", "registerScript", "reloadPage", "cleanup", "Page.addScriptToEvaluateOnNewDocument", "Page.reload", "Page.loadEventFired", "InjectionError", "ErrorCode", "PORT_FORWARD_FAILED", "NO_TABS", "WebSocket"]
  - path: "tests/cli/device.test.ts"
    contains: ["createDeviceManager", "detectDevices", "selectDevice", "emulator-5554", "NO_DEVICE", "DEVICE_NOT_FOUND", "InjectionError"]
  - path: "tests/cli/cdp.test.ts"
    contains: ["createCDP", "forwardCDP", "discoverTabs", "registerScript", "reloadPage", "cleanup", "PORT_FORWARD_FAILED", "NO_TABS", "Page.addScriptToEvaluateOnNewDocument", "Page.reload", "Page.loadEventFired", "WebSocket"]
key_links:
  - pattern: "import { InjectionError, ErrorCode"
    in: ["src/cli/device.ts", "src/cli/cdp.ts"]
  - pattern: "export function createDeviceManager"
    in: ["src/cli/device.ts"]
  - pattern: "export function createCDP"
    in: ["src/cli/cdp.ts"]
  - pattern: "export interface Device"
    in: ["src/cli/device.ts"]
  - pattern: "export interface CDPConnection"
    in: ["src/cli/cdp.ts"]
  - pattern: "export interface Tab"
    in: ["src/cli/cdp.ts"]
  - pattern: "export type ExecFn"
    in: ["src/cli/device.ts"]
  - pattern: "import { createDeviceManager"
    in: ["tests/cli/device.test.ts"]
  - pattern: "import { createCDP"
    in: ["tests/cli/cdp.test.ts"]
  - pattern: "adb devices"
    in: ["src/cli/device.ts", "tests/cli/device.test.ts"]
  - pattern: "adb -s"
    in: ["src/cli/device.ts", "src/cli/cdp.ts"]
  - pattern: "Page.addScriptToEvaluateOnNewDocument"
    in: ["src/cli/cdp.ts", "tests/cli/cdp.test.ts"]

## Dev Notes

### Verified Library Versions (as of 2026-03-11)
- **ws:** ^8.19.0 (latest stable) -- WebSocket client for CDP communication. Production dependency.
- **@types/ws:** ^8.18.1 (latest) -- TypeScript types for ws. Dev dependency.
- **TypeScript:** ^5.9.3 (already installed)
- **Vitest:** ^4.0.18 (already installed)
- **ESLint:** ^10.0.3 (already installed)
- **Prettier:** ^3.8.1 (already installed)

### New Dependencies for This Story
- `ws` (production) -- required by DD-13 for CDP WebSocket communication
- `@types/ws` (dev) -- TypeScript definitions

### Conventions from Prior Stories (Stories 1-1, 1-2, 2-1)
- **Import style:** ES modules with `.js` extensions in import paths (e.g., `import { ErrorCode } from "./errors.js"`)
- **Naming:** `camelCase` for functions/variables, `PascalCase` for types/interfaces/classes, `UPPER_SNAKE_CASE` for constants
- **Test organization:** Mirror source structure under `tests/`. One test file per source module. `describe` blocks per function/class, `it` blocks per behavior.
- **Test environment:** CLI tests use `// @vitest-environment node` directive. The global vitest config sets `environment: "jsdom"` which is for payload tests only.
- **Mocking pattern:** `vi.spyOn()` for spying on existing methods. `vi.fn()` for creating mock functions (used for dependency injection mocks like `exec`). `afterEach(() => { vi.restoreAllMocks(); })` for cleanup.
- **Error handling:** Throw `InjectionError` with `ErrorCode` and optional `context` for template substitution. E.g., `new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial: "abc123" })` produces message `"Device 'abc123' not found"`.
- **ESLint:** Flat config in `eslint.config.mjs` using `typescript-eslint`. Extends `@typescript-eslint/recommended` + `@typescript-eslint/strict`.
- **Prettier:** Empty config (`{}` in `.prettierrc`) -- uses all defaults.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, target `ES2022`, module `ESNext`, moduleResolution `bundler`.
- **Package type:** `"type": "module"` in package.json -- all imports use ESM.

### Story 2-1 Specific Learnings
- `InjectionError` constructor accepts optional `context: Record<string, string>` for template placeholder substitution. Use this for `DEVICE_NOT_FOUND` (pass `{ serial }`) and `TIMEOUT` (pass `{ ms }`).
- `ERROR_META` stores message templates with `{placeholder}` syntax. The `InjectionError` constructor handles substitution automatically.
- Logger methods: `info` and `success` write to stdout via `console.log`. `error` writes to stderr via `console.error`. `debug` writes to stderr via `process.stderr.write` (only when verbose).
- Test pattern for errors: use `expect(error.code).toBe(ErrorCode.X)` and `expect(error).toBeInstanceOf(InjectionError)`.
- Tests use `beforeEach`/`afterEach` for spy setup and cleanup (established in tests/cli/logger.test.ts).

### Story 1-2 Specific Learnings
- The `@solana-mobile/wallet-standard-mobile` package is installed as `^0.4.4` (not the beta mentioned in the story file -- the actual package.json shows `^0.4.4`).
- Build script is `scripts/build.mjs` (plain JS, not TS) to avoid needing a TypeScript runner.
- `dist/` directory is for build output.

### Testing CDP WebSocket Interactions
CDP tests require mock WebSocket objects that simulate the event-driven protocol:
1. Create a mock WebSocket class that stores `on` handlers and has `send`/`close` methods
2. After `send` is called, trigger the corresponding `message` event with a mock CDP response
3. For `reloadPage`: trigger `message` with `{ method: "Page.loadEventFired" }` event
4. Use `vi.useFakeTimers()` for testing exponential backoff in `discoverTabs`
5. For timeout tests: advance fake timers past `CDP_TIMEOUT` to trigger timeout rejection

### Testing HTTP Requests
Mock the `http.get` dependency with a function that:
1. Accepts a URL and callback
2. Calls the callback with a mock `IncomingMessage` (an EventEmitter with `on("data")` and `on("end")`)
3. Emit `data` with the JSON response body, then emit `end`

### ExecFn Type Sharing
The `ExecFn` type is defined in `device.ts` and also needed by `cdp.ts`. Options:
- Export from `device.ts`, import in `cdp.ts` -- simple but creates a dependency
- Define in both files -- duplicates the type but avoids coupling
- Create a shared `types.ts` -- overengineered for one type alias

**Recommended:** Export `ExecFn` from `device.ts` and import it in `cdp.ts`. The dependency direction (cdp imports from device) is acceptable since both are in the same `cli/` subsystem and the orchestrator in `index.ts` creates both.

### Async vs Sync Method Considerations
- `detectDevices()` and `selectDevice()` are **synchronous** -- they use `execSync` via the `exec` dependency
- `forwardCDP()` is **synchronous** -- uses `execSync` via `exec`
- `cleanup()` is **synchronous** -- must be for signal handler compatibility
- `discoverTabs()` is **async** -- HTTP requests are inherently async
- `registerScript()` is **async** -- WebSocket communication is async
- `reloadPage()` is **async** -- WebSocket + waiting for events is async

## Wave Structure
Wave 1: [Task 1, Task 2] -- Task 1 (npm install ws) is a prerequisite for Task 3 (cdp.ts imports ws types). Task 2 (device.ts) has no dependency on ws and can run in parallel with Task 1. Both produce independent files.

Wave 2: [Task 3] -- cdp.ts depends on Task 1 (ws types available) and Task 2 (imports ExecFn from device.ts). Must wait for Wave 1.

Wave 3: [Task 4, Task 5] -- Test files for device and cdp. Independent files, no shared state, no shared test fixtures. Task 4 tests device.ts only. Task 5 tests cdp.ts only. Can run in parallel.

Wave 4: [Task 6, Task 7] -- Task 6 (vitest config update) and Task 7 (verification pass). Task 7 depends on all prior waves. Task 6 is a minor config change that can happen alongside Task 7 or before it. Sequential after Wave 3.

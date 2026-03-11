---
status: complete
created: 2026-03-11T10:53:30.000Z
feature: injection-tool
phase: 3
---
# Architecture: MWA Standard Wallet Injection Tool

## Goals & Constraints

### Architecture Drivers
- **Single-command automation**: QA engineer runs one CLI command → wallet appears in dApp picker (FR-1)
- **Two-artifact boundary**: Host-side CLI (Node.js) delivers payload to browser-side IIFE via CDP (AC-D-1, C-14)
- **Self-contained payload**: Single IIFE file < 150 KB, zero runtime deps (NFR-1, NFR-5)
- **Idempotent injection**: Safe to run multiple times, no duplicate registrations (FR-4, C-8)
- **Testable CLI logic**: All non-trivial logic in TypeScript/Node.js, not shell (AC-D-1)

### Non-Negotiable Boundaries
- esbuild bundler (DD-1 LOCKED)
- No web3.js (DD-2 LOCKED)
- Idempotency via `window.__MWA_INJECTED__` (DD-3 LOCKED)
- CDP for automated delivery (DD-7 LOCKED)
- HTTPS-only target pages (C-1)
- Android-only (C-2)
- `adb` required on host (C-13)

## Component Decomposition

### System Context (C4 Level 1)

```
┌──────────────────────────────────────────────────────────────┐
│                     QA Engineer                               │
│                         │                                     │
│                    runs CLI command                            │
│                         ▼                                     │
│  ┌─────────────────────────────────┐                          │
│  │   CLI (Node.js on host)         │                          │
│  │   - Device detection (adb)      │                          │
│  │   - CDP port forwarding         │                          │
│  │   - Tab discovery               │                          │
│  │   - Payload delivery            │──── adb + CDP ────┐      │
│  └─────────────────────────────────┘                   │      │
│                                                        ▼      │
│                                    ┌───────────────────────┐  │
│                                    │ Chrome on Android      │  │
│                                    │ ┌───────────────────┐ │  │
│                                    │ │ Solana dApp page   │ │  │
│                                    │ │ + mwa-inject.js    │ │  │
│                                    │ │   (injected IIFE)  │ │  │
│                                    │ └────────┬──────────┘ │  │
│                                    │          │ ws://      │  │
│                                    │          ▼            │  │
│                                    │ ┌───────────────────┐ │  │
│                                    │ │ MWA Wallet App    │ │  │
│                                    │ │ (Phantom, etc.)   │ │  │
│                                    │ └───────────────────┘ │  │
│                                    └───────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Component Architecture (C4 Level 3)

Two independent subsystems with a clean unidirectional boundary:

#### Subsystem A: CLI (Host-side, Node.js)

```
src/cli/
├── index.ts          # Entry point — orchestrates pipeline
├── device.ts         # ADB device detection + selection
├── cdp.ts            # CDP port forwarding, tab discovery, Runtime.evaluate
├── errors.ts         # Error catalog — all failure codes/messages
└── logger.ts         # Structured logging with --verbose support
```

| Component | Responsibility | Interface |
|-----------|---------------|-----------|
| `cli/index.ts` | Pipeline orchestration: detect → forward → discover → inject → verify → cleanup | `main(): Promise<void>` — exit code 0/1 |
| `cli/device.ts` | List devices via `adb devices`, parse output, prompt for selection if multiple | Factory: `createDeviceManager(deps: { exec }): DeviceManager` with `detectDevices()`, `selectDevice()` |
| `cli/cdp.ts` | Set up `adb forward` (ephemeral port), HTTP GET `/json` for tabs, WebSocket `Runtime.evaluate`, cleanup | Factory: `createCDP(deps: { exec, http, WebSocket }): CDPClient` with methods `forwardCDP()`, `discoverTabs()`, `evaluatePayload()`, `cleanup()` |
| `cli/errors.ts` | Error catalog with codes, messages, remediation hints, and retryable flag | `enum ErrorCode`, `class InjectionError extends Error`, `ERROR_META: Record<ErrorCode, { message, remediation, retryable }>` |
| `cli/logger.ts` | Structured logging — normal mode (success/failure) + verbose mode (timestamp, step name, ADB/CDP details to stderr) | Factory: `createLogger(opts: { verbose: boolean }): Logger` |

**CLI flags:**
- `--device <serial>` — skip interactive prompt, use specified device
- `--verbose` — enable debug-level logging to stderr
- `--watch` — (SHOULD) auto-re-inject on page load events

#### Subsystem B: Injection Payload (Browser-side, IIFE)

```
src/payload/
├── index.ts          # IIFE entry — guard → config → register → confirm
├── guard.ts          # Idempotency + environment validation
├── config.ts         # Derive registerMwa() options from page context
└── constants.ts      # Shared constants (flag name, log prefix, chains)
```

| Component | Responsibility | Interface |
|-----------|---------------|-----------|
| `payload/index.ts` | IIFE entry: call guard, build config, call registerMwa(), log result, return status | Self-executing, returns `{ success: boolean, reason: string }` |
| `payload/guard.ts` | Check: not already injected (`window.__MWA_INJECTED__`), is Android UA, is secure context | `guard(): { canInject: boolean, reason?: string }` |
| `payload/config.ts` | Derive `appIdentity` from `document.title` / `location.origin`, favicon discovery (link[rel~="icon"] → /favicon.ico fallback → omit), set chains, defaults | `buildConfig(): RegisterMwaConfig` |
| `payload/constants.ts` | Named constants: `INJECTED_FLAG = '__MWA_INJECTED__'`, `LOG_PREFIX = '[MWA Inject]'`, `CHAINS`, `CDP_TIMEOUT = 10_000`, `ADB_TIMEOUT = 15_000` | Exported constants |

**Boundary rule:** The payload has ZERO awareness of the CLI. It works identically when pasted manually (UC-4). The CLI reads the built payload file and sends it as a string via `Runtime.evaluate`.

#### Build System

```
├── package.json          # Dependencies + scripts
├── tsconfig.json         # Strict TypeScript config
├── tsconfig.cli.json     # CLI-specific config (Node.js target)
├── esbuild.config.mjs    # Payload build: IIFE bundle
├── scripts/
│   └── build.ts          # Build orchestrator: payload + size check
└── dist/
    ├── mwa-inject.min.js # Minified payload (< 150 KB)
    ├── mwa-inject.js     # Debug payload (readable names)
    └── cli.js            # Compiled CLI entry point
```

#### Auxiliary Files

```
├── test/
│   └── test-dapp.html    # Wallet-standard verification page
├── scripts/
│   └── inject.sh         # Thin shell wrapper: delegates to `node dist/cli.js`
└── README.md             # Quick start, troubleshooting, CSP guide
```

## Data Models

### Device

```typescript
interface Device {
  serial: string;      // e.g., "emulator-5554" or "HVA7N18A14000257"
  type: "device" | "emulator";
  model: string;       // from `adb shell getprop ro.product.model`
}
```

### CDPConnection

```typescript
interface CDPConnection {
  device: Device;
  localPort: number;     // ephemeral port bound by adb forward
  wsEndpoint: string;    // WebSocket URL for CDP commands
}
```

### Tab

```typescript
interface Tab {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  type: "page" | "background_page" | "service_worker";
}
```

### EvalResult

```typescript
interface EvalResult {
  success: boolean;
  reason: string;
  exceptionDetails?: {
    text: string;
    exception?: { description: string };
  };
}
```

### GuardResult

```typescript
type GuardReason = "already_injected" | "not_android" | "not_secure_context";

interface GuardResult {
  canInject: boolean;
  reason?: GuardReason;
}
```

The CLI MUST exhaustively handle all `GuardReason` values when mapping to user-facing messages (e.g., via `Record<GuardReason, string>` lookup).

### RegisterMwaConfig

```typescript
interface RegisterMwaConfig {
  appIdentity: {
    name: string;   // document.title || location.hostname
    uri: string;    // location.origin
    icon?: string;  // favicon href if found
  };
  chains: string[];           // ['solana:mainnet', 'solana:devnet', 'solana:testnet']
  authorizationCache: object; // default localStorage cache
}
```

N/A — No persistent data store, no database, no migrations. All data is transient within a single CLI invocation or browser page session.

## Key Workflows

### Workflow 1: Automated Injection (Primary — UC-1)

```
QA Engineer runs: ./scripts/inject.sh [--device <serial>] [--verbose]
  │
  ▼
cli/index.ts: main()
  │
  ├─1─ device.detectDevices()
  │    ├─ Run: adb devices
  │    ├─ Parse output → Device[]
  │    ├─ 0 devices → ERROR: NO_DEVICE ("No Android devices found. Check USB + debugging.")
  │    ├─ 1 device → use it
  │    └─ N devices → --device flag? use it : prompt selection (show model + type)
  │
  ├─2─ cdp.forwardCDP(device)
  │    ├─ Run: adb -s <serial> forward tcp:0 localabstract:chrome_devtools_remote
  │    ├─ Parse ephemeral port from output
  │    ├─ Failure → ERROR: PORT_FORWARD_FAILED ("Could not forward CDP port. Is Chrome running?")
  │    └─ Register cleanup handler (SIGINT, SIGTERM, process.on('exit'))
  │
  ├─3─ cdp.discoverTabs(conn) [retry 3x with backoff]
  │    ├─ HTTP GET http://localhost:<port>/json
  │    ├─ Filter: type === "page"
  │    ├─ 0 tabs → ERROR: NO_TABS ("No Chrome tabs found. Open a dApp in Chrome first.")
  │    ├─ 1 tab → use it, log URL + title
  │    └─ N tabs → log selected tab URL + title (heuristic: first page tab)
  │
  ├─4─ cdp.evaluatePayload(tab, payloadString)
  │    ├─ WebSocket connect to tab.webSocketDebuggerUrl
  │    ├─ Send: { method: "Runtime.evaluate", params: { expression: payload, returnByValue: true } }
  │    ├─ Response has exceptionDetails → ERROR: PAYLOAD_EXCEPTION (include exception text)
  │    └─ Response has result.value → parse { success, reason }
  │
  ├─5─ Verify: second Runtime.evaluate("window.__MWA_INJECTED__")
  │    ├─ true → log "✓ Wallet registration confirmed"
  │    └─ false/undefined → WARN: "Wallet registration could not be verified"
  │
  └─6─ cdp.cleanup(conn)
       ├─ Close WebSocket
       └─ Run: adb -s <serial> forward --remove tcp:<port>
```

### Workflow 2: Re-injection After Navigation (UC-2)

Same as Workflow 1. On re-run:
- If SPA (no full reload): payload detects `__MWA_INJECTED__` flag → logs "Already injected, skipping" → CLI reports success (already injected)
- If full page load: flag is gone → normal injection proceeds

### Workflow 3: Manual Paste Fallback (UC-4)

```
QA Engineer pastes mwa-inject.min.js into DevTools console
  │
  ▼
payload/index.ts (IIFE auto-executes)
  ├─ guard() → check flag, Android, HTTPS
  ├─ buildConfig() → derive from page
  ├─ registerMwa(config)
  ├─ Set window.__MWA_INJECTED__ = true
  └─ console.log("[MWA Inject] Wallet registered successfully")
      or console.error("[MWA Inject] Skipped: {reason}")
```

### Workflow 4: Build (FR-11)

```
npm run build
  │
  ▼
scripts/build.ts
  ├─ esbuild payload: src/payload/index.ts → dist/mwa-inject.min.js (minified IIFE)
  ├─ esbuild payload: src/payload/index.ts → dist/mwa-inject.js (debug IIFE, no minify)
  ├─ esbuild CLI: src/cli/index.ts → dist/cli.js (Node.js CJS)
  ├─ Check: dist/mwa-inject.min.js size < 150,000 bytes
  │    ├─ PASS → log "Bundle: {size} bytes ({kb} KB) — within 150 KB limit"
  │    └─ FAIL → error + exit 1: "Bundle {size} bytes exceeds 150 KB limit"
  └─ Done
```

## Error Handling Strategy

### Error Taxonomy

All errors defined in `cli/errors.ts`:

| Code | Step | Message Template | Remediation |
|------|------|-----------------|-------------|
| `NO_DEVICE` | Device detection | "No Android devices found" | "Check USB connection and enable USB debugging in Developer Options" |
| `DEVICE_NOT_FOUND` | Device selection | "Device '{serial}' not found" | "Run `adb devices` to list available devices" |
| `PORT_FORWARD_FAILED` | CDP setup | "Could not forward CDP port" | "Ensure Chrome is running on the device" |
| `NO_TABS` | Tab discovery | "No debuggable Chrome tabs found" | "Open a Solana dApp in Chrome on the device" |
| `TAB_CONNECT_FAILED` | CDP WebSocket | "Could not connect to tab" | "Try closing and reopening Chrome on the device" |
| `PAYLOAD_EXCEPTION` | Runtime.evaluate | "Payload threw: {exception}" | "Check payload build or try debug variant" |
| `PAYLOAD_NOT_FOUND` | File read | "Payload file not found at {path}" | "Run `npm run build` first" |
| `VERIFY_FAILED` | Verification | "Wallet registration could not be verified" | "Injection may have succeeded — check the dApp's wallet picker" |
| `BUNDLE_TOO_LARGE` | Build | "Bundle {size} bytes exceeds 150 KB" | "Audit dependencies for size" |
| `TIMEOUT` | CDP/ADB | "Operation timed out after {ms}ms" | "Check device connection and Chrome responsiveness" |

### Error Propagation

```
cli/device.ts  ──throws InjectionError──┐
cli/cdp.ts     ──throws InjectionError──┤
                                        ▼
cli/index.ts   ──catches──→ logger.error(code, message)
                          → cleanup (always runs)
                          → process.exit(1)
```

- All errors are `InjectionError` with an `ErrorCode` enum value
- `cli/index.ts` wraps the pipeline in try/catch/finally
- `finally` always calls `cleanup()` to remove port forwards
- Exit code: 0 = success, 1 = failure
- Verbose mode logs the full stack trace to stderr

### Payload-Level Errors

The payload runs in the browser context and cannot throw to the CLI. Instead:
- It returns `{ success: false, reason: "not_android" }` as the `Runtime.evaluate` result
- The CLI inspects this return value and maps it to the appropriate terminal message
- Console messages (`[MWA Inject] ...`) are visible in DevTools but NOT captured by the CLI (the CLI uses the return value, not console output)

## CLI Command Structure

```
inject.sh [options]
  └── node dist/cli.js [options]

Options:
  --device <serial>   Use specific device (skip interactive prompt)
  --verbose           Enable debug logging to stderr
  --watch             (SHOULD) Auto-re-inject on page navigation
  --help              Show usage
  --version           Show version

Exit codes:
  0   Injection successful (or already injected)
  1   Injection failed (see error message)
```

The shell script `scripts/inject.sh` is a thin wrapper:
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/dist/cli.js" "$@"
```

All logic lives in `dist/cli.js` (compiled from `src/cli/`). The shell script exists only for convenience (`./scripts/inject.sh` vs `node dist/cli.js`).

## Design Rationale

### Carried from Research (LOCKED)
- **DD-1:** esbuild over Rollup — faster, simpler, equivalent IIFE output [LOCKED]
- **DD-2:** No web3.js — inherited from `@solana-mobile/wallet-standard-mobile` [LOCKED]
- **DD-3:** Idempotency via `window.__MWA_INJECTED__` flag [LOCKED]
- **DD-4:** No UA spoofing — Android check passes naturally on devices [LOCKED]
- **DD-5:** All three chains registered [LOCKED]
- **DD-6:** App identity derived from page context [LOCKED]
- **DD-7:** CDP for automated payload delivery [LOCKED]

### New Architecture Decisions

- **DD-8:** CLI in Node.js TypeScript, not shell script [LOCKED]
  - Alternatives: Pure bash, Python, Deno
  - Rationale: AC-D-1 requires testable language. TypeScript matches the payload language (single toolchain). Node.js has native `child_process` for adb, `http` for CDP HTTP, `ws` for CDP WebSocket. No additional runtime needed since Node.js is already required for the build.

- **DD-9:** Separate `src/cli/` and `src/payload/` directories [LOCKED]
  - Alternatives: Flat `src/` with all files, monorepo packages
  - Rationale: Clean boundary — payload is bundled into browser IIFE, CLI is compiled to Node.js CJS. They share no code at runtime. `constants.ts` is in `payload/` because it's bundled into the IIFE; the CLI reads the flag name from the built payload's return value.

- **DD-10:** Error catalog as single module (`errors.ts`) [LOCKED]
  - Alternatives: Inline error messages, error constants per module
  - Rationale: AC-D-2 requires all failure modes in one location. Single module enables consistent formatting and easy documentation.

- **DD-11:** Tab selection heuristic — check `/json/version` for focused tab first, fall back to first "page" type from `/json` [DISCRETION]
  - Alternatives: Most recently active, user prompt always, URL pattern matching
  - Rationale: CDP `/json/version` returns the currently focused tab's WebSocket URL when available — more accurate than assuming first in `/json` list. Falls back to first page-type tab if `/json/version` lacks the info. CLI always logs the selected tab URL/title so the user can verify. For multiple-tab ambiguity, future enhancement could add `--tab <url-pattern>`.

- **DD-12:** Thin shell wrapper delegating to Node.js [LOCKED]
  - Alternatives: No shell script (just `node dist/cli.js`), npm bin script
  - Rationale: `./scripts/inject.sh` is more ergonomic than `node dist/cli.js` for QA engineers. Shell script is < 5 lines, only does path resolution + exec. Could add npm bin later.

- **DD-13:** `ws` npm package for CDP WebSocket [DISCRETION]
  - Alternatives: Node.js 22+ native WebSocket, raw `net` socket
  - Rationale: `ws` is battle-tested, lightweight (~50 KB), widely used. Node.js native WebSocket is available in 22+ but we target Node 18+. Could switch to native WebSocket if minimum Node version is raised.

## Testing Strategy

### Framework & Tools
- **Test runner:** Vitest (fast, TypeScript-native, ESM support)
- **Formatter:** Prettier (default config)
- **Linter:** ESLint with `@typescript-eslint/recommended`
- **Coverage target:** >= 80% line coverage for pure logic modules (`guard.ts`, `config.ts`, `constants.ts`, `device.ts`, `errors.ts`)
- **Mocking:** Vitest built-in mocks for `child_process` (adb calls), `http` (CDP HTTP), `ws` (CDP WebSocket)

### Test Categories

| Category | Scope | Approach |
|----------|-------|----------|
| Unit: payload/guard | Idempotency flag, Android check, HTTPS check | Mock `window` globals, test all branches |
| Unit: payload/config | appIdentity derivation, chain setup | Mock `document.title`, `location` |
| Unit: cli/device | ADB output parsing, device selection | Mock `child_process.execSync` |
| Unit: cli/cdp | CDP response parsing, error extraction | Mock HTTP responses, WebSocket messages |
| Unit: cli/errors | Error code → message mapping | Direct assertion |
| Integration: build | Bundle size < 150 KB, both outputs exist | Run actual build, check fs |
| Manual: test-dapp.html | End-to-end on real device/emulator | Inject → verify wallet in picker |

### Test File Structure

```
tests/
├── payload/
│   ├── guard.test.ts
│   └── config.test.ts
├── cli/
│   ├── device.test.ts
│   └── cdp.test.ts
└── build.test.ts
```

### What We Don't Test Automatically
- MWA wallet handshake (requires real device + wallet app)
- CDP communication with actual Chrome (requires adb + device)
- Third-party dApp compatibility (manual verification via test-dapp.html)

These are verified manually during QA using UC-1, UC-2, UC-3.

## Security

**Depth: Low** — Internal QA/dev tool, no PII, no auth, no external APIs, no user-facing deployment.

### Dependency Scanning
- Run `npm audit` before releases
- Pin major versions of `@solana-mobile/wallet-standard-mobile` and `ws`
- Monitor for CVEs in transitive dependencies (bs58, js-base64, qrcode)

### CDP Port Security
- **Ephemeral port**: `adb forward tcp:0` lets the OS assign a random available port (AC-A-3)
- **Localhost only**: `adb forward` binds to 127.0.0.1 by default — not externally accessible
- **Teardown on exit**: Signal handlers (SIGINT, SIGTERM) + `process.on('exit')` remove the forward via synchronous `execSync('adb forward --remove ...')` to guarantee cleanup before process exits (AC-A-1)
- **Short-lived**: Port is open only during injection (seconds, not minutes)

### Payload Safety
- The payload runs in the target page's JS context with the page's privileges — it cannot escalate beyond what the page already has
- No data exfiltration — the payload only calls `registerMwa()` and sets a flag
- No network requests from the payload itself — MWA WebSocket connections are initiated by the registered wallet adapter only when the user explicitly selects it

### Secret Management
- No secrets or API keys needed
- No `.env` files
- ADB communicates over USB, no credentials involved

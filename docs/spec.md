---
status: complete
created: 2026-03-11T10:06:01.000Z
feature: injection-tool
brief: docs/research.md
---
# Specification: MWA Standard Wallet Injection Tool

## Overview

A bundled JavaScript payload and CLI script that injects MWA wallet registration into any Solana dApp web page on an Android device or emulator. The CLI script automates the entire flow — device detection, port forwarding, and payload injection via Chrome DevTools Protocol (CDP) — so the QA engineer runs a single command and the wallet appears in the dApp's picker.

## Use Cases

### UC-1: Auto-Inject MWA Wallet on Third-Party dApp
QA engineer runs the injection script to automatically inject the MWA wallet into a Solana dApp running on a connected Android device.
- **Primary actor:** QA Engineer
- **Precondition:** Android device or emulator is USB-connected with USB debugging enabled; Chrome is open on a Solana dApp page served over HTTPS; `adb` is available on the host machine
- **Main flow:**
  1. QA Engineer runs the injection script (e.g., `./scripts/inject.sh`)
  2. Script detects the connected device via `adb`
  3. Script sets up CDP port forwarding to the device's Chrome
  4. Script discovers the active browser tab and its WebSocket debug URL
  5. Script sends the injection payload to the tab via CDP (`Runtime.evaluate`)
  6. Payload validates the environment (secure context, Android platform, not already injected)
  7. Payload registers the MWA wallet with all three chain variants
  8. Script outputs a success confirmation to the terminal
  9. QA Engineer opens the dApp's wallet picker
  10. The MWA wallet appears as a selectable option
  11. QA Engineer selects MWA → wallet app (e.g., Phantom) opens → user approves → connected to dApp
- **Alternative flows:**
  - No device connected: Script outputs an error with troubleshooting steps
  - Multiple devices connected: Script lists devices and prompts selection
  - No Chrome tabs open: Script outputs an error asking the user to open a dApp in Chrome first
  - Non-secure context: Payload logs an error indicating HTTPS is required; wallet is not registered
  - Already injected: Payload detects previous injection, logs skip message
  - CSP blocks local WebSocket: Connect flow fails at wallet-handshake step; error modal shown
- **Postcondition:** MWA wallet is registered in the dApp's wallet picker and QA Engineer can complete the MWA connect flow

### UC-2: Re-inject After Page Navigation
QA engineer re-runs the script after navigating to a new page within the dApp.
- **Primary actor:** QA Engineer
- **Precondition:** QA Engineer has previously injected; a page navigation or reload has occurred
- **Main flow:**
  1. QA Engineer navigates to a different page within the dApp
  2. QA Engineer re-runs the injection script
  3. Script re-discovers the active tab and injects the payload
  4. Payload validates the environment (fresh page, no previous injection flag)
  5. Payload registers the MWA wallet
  6. Script confirms success
  7. The MWA wallet appears in the wallet picker on the new page
- **Alternative flows:**
  - Single-page app with no full reload: Previous injection is still active; payload detects the flag and skips, script reports already injected
- **Postcondition:** MWA wallet is available in the wallet picker on the current page

### UC-3: Local Verification
QA engineer verifies the injection works using the bundled test page before testing on production dApps.
- **Primary actor:** QA Engineer
- **Precondition:** Project is built; test HTML page is available on device
- **Main flow:**
  1. QA Engineer opens the test HTML page in Chrome on the Android device
  2. QA Engineer runs the injection script
  3. Script injects the payload via CDP
  4. Test page displays the registered wallet in its wallet list
  5. QA Engineer confirms the wallet entry is present
- **Alternative flows:**
  - Test page opened over HTTP (not HTTPS): Payload logs a secure context error
- **Postcondition:** QA Engineer has confirmed the injection payload works in a controlled environment

### UC-4: Manual Injection via DevTools Console (Fallback)
QA engineer manually pastes the payload into Chrome DevTools console as a fallback when the automated script is not available.
- **Primary actor:** QA Engineer
- **Precondition:** DevTools remote debugging session is active; payload file is accessible
- **Main flow:**
  1. QA Engineer opens `chrome://inspect` on desktop Chrome
  2. QA Engineer clicks "inspect" on the target tab
  3. QA Engineer pastes the contents of `mwa-inject.min.js` into the console and presses Enter
  4. Payload validates, registers, and logs success
  5. MWA wallet appears in the dApp's picker
- **Alternative flows:**
  - Same as UC-1 alternative flows for payload-level errors
- **Postcondition:** Same as UC-1

## Functional Requirements (Capability Contract)

### Injection & Registration
- **FR-1:** [QA Engineer] can [run a single CLI command to inject the MWA wallet into any Solana dApp page] [on a USB-connected Android device or emulator without opening DevTools manually]
- **FR-2:** [QA Engineer] can [see the MWA wallet appear in the dApp's wallet picker] [immediately after injection, without requiring a page reload]
- **FR-3:** [QA Engineer] can [complete the MWA connect flow through the injected wallet] [using any MWA-compatible wallet app on the device (e.g., Phantom, Solflare)]
- **FR-4:** [QA Engineer] can [run the injection multiple times on the same page] [without causing duplicate wallet registrations or errors]

### Automated Delivery (CDP)
- **FR-5:** [QA Engineer] can [have the injection script automatically detect connected Android devices] [without manually specifying device identifiers]
- **FR-6:** [QA Engineer] can [have the injection script automatically discover the active Chrome tab] [and inject the payload into it via the debugging protocol]
- **FR-7:** [QA Engineer] can [select a specific device when multiple are connected] [via a prompt from the injection script]

### Feedback & Configuration
- **FR-8:** [QA Engineer] can [see terminal output confirming whether the injection succeeded or failed] [including the reason for failure]
- **FR-9:** [QA Engineer] can [use the injection on any Solana chain (mainnet, devnet, testnet)] [without changing script configuration]
- **FR-10:** [QA Engineer] can [inject the wallet with app identity derived automatically from the current page] [without manually specifying application name or origin]

### Build & Verification
- **FR-11:** [QA Engineer] can [build the injection payload in both minified and debug variants] [from the project source]
- **FR-12:** [QA Engineer] can [verify wallet registration locally using a test HTML page] [before testing on third-party dApps]

### Fallback
- **FR-13:** [QA Engineer] can [manually paste the payload into a browser console] [as a fallback when the automated script is not available]

## Non-Functional Requirements

- **NFR-1:** Bundle Size — Minified payload must be < 150 KB
- **NFR-2:** Compatibility — Injection must function on Chrome 100+ on Android
- **NFR-3:** Compatibility — Injection must work on both physical Android devices and emulators
- **NFR-4:** Build Toolchain — Build must run on Node.js >= 18
- **NFR-5:** Portability — Payload must be a single file with zero external runtime dependencies

## Quality Perspectives

### End User (8 concerns)
| # | Concern | Priority | AC |
|---|---------|----------|----|
| 1 | Ambiguous "active tab" — wrong tab injected silently | HIGH | AC-U-1 |
| 2 | No timeout feedback for 30s MWA handshake | HIGH | AC-U-2 |
| 3 | Test page HTTPS bootstrap not specified | HIGH | AC-U-3 |
| 4 | No step-specific error messages in pipeline | MED | AC-U-4 |
| 5 | Device prompt shows bare serial numbers | MED | AC-U-5 |
| 6 | CSP failures not diagnosable | MED | AC-U-6 |
| 7 | No post-injection verification probe | MED | AC-U-7 |
| 8 | Repetitive re-injection on multi-page flows | LOW | AC-U-8 |

### Architect (7 concerns)
| # | Concern | Priority | Category | AC |
|---|---------|----------|----------|----|
| 1 | CDP port forwarding cleanup on crash | MED | reliability | AC-A-1 |
| 2 | No retry/timeout for tab discovery | MED | reliability | AC-A-2 |
| 3 | Security of CDP port forward | MED | security | AC-A-3 |
| 4 | No validation of Runtime.evaluate response | MED | boundary | AC-A-4 |
| 5 | CSP failure silent at injection time | LOW | reliability | AC-A-5 |
| 6 | Bundle size no build-time gate | LOW | boundary | AC-A-6 |
| 7 | Device selection only interactive | LOW | boundary | AC-A-7 |

### Maintainer (8 concerns)
| # | Concern | Priority | Category | AC |
|---|---------|----------|----------|----|
| 1 | Shell script as primary CLI untestable | HIGH | testability | AC-D-1 |
| 2 | No error taxonomy | MED | debuggability | AC-D-2 |
| 3 | No unit tests for pure logic | HIGH | testability | AC-D-3 |
| 4 | Idempotency flag name implicit | MED | readability | AC-D-4 |
| 5 | Bundle size no automated enforcement | MED | extensibility | AC-D-5 |
| 6 | Active tab semantics ambiguous | MED | readability | AC-D-6 |
| 7 | No verbose/debug logging | LOW | debuggability | AC-D-7 |
| 8 | No tooling configured | LOW | extensibility | AC-D-8 |

## Acceptance Criteria

### AC-U: End User Criteria

- **AC-U-1:** When multiple Chrome tabs are open, the CLI MUST print the URL and title of the tab selected for injection; when more than one candidate tab exists, the CLI MUST either prompt for selection or log the heuristic used.
- **AC-U-2:** When the MWA wallet handshake times out (30s), the CLI or payload MUST display a timeout-specific error with at least one remediation action (e.g., "ensure wallet app is installed and unlocked").
- **AC-U-3:** Project documentation MUST include step-by-step instructions for serving the test HTML page over HTTPS on the Android device or emulator.
- **AC-U-4:** Each distinct failure point in the injection pipeline (device detection, port forwarding, tab discovery, CDP connection, Runtime.evaluate, wallet registration) MUST produce a unique error message containing the step name and a remediation hint.
- **AC-U-5:** When multiple devices are connected, the device selection prompt MUST display device model name and type (physical/emulator) alongside the serial number.
- **AC-U-6:** Project documentation MUST include a CSP troubleshooting section explaining how CSP can block the MWA connect flow, how to identify it, and known limitations.
- **AC-U-7:** After executing Runtime.evaluate, the CLI MUST perform a verification probe (check `window.__MWA_INJECTED__` flag) and report "wallet registration confirmed" or "could not be verified" with guidance.
- **AC-U-8:** (SHOULD) The CLI SHOULD support a `--watch` flag that listens for CDP page load events and automatically re-injects on navigation, printing a confirmation each time.

### AC-FR: Functional Completeness

- **AC-FR-1:** Running the CLI with a single command on a USB-connected Android device with Chrome on a Solana dApp MUST result in the MWA wallet appearing in the dApp's picker. (covers FR-1)
- **AC-FR-2:** The MWA wallet MUST appear in the picker without requiring a page reload; the wallet-standard register event must fire during payload execution. (covers FR-2)
- **AC-FR-3:** After injection, selecting MWA in the picker MUST initiate the connect flow and open the wallet app on the device for approval. (covers FR-3)
- **AC-FR-4:** Running the payload N times (N >= 3) on the same page MUST result in exactly one registration; subsequent runs MUST detect the flag and skip without errors. (covers FR-4)
- **AC-FR-5:** The CLI MUST detect connected Android devices via `adb devices` without requiring user-provided serial numbers. (covers FR-5)
- **AC-FR-6:** The CLI MUST discover at least one debuggable Chrome tab via CDP `/json` endpoint and inject the payload via `Runtime.evaluate`. (covers FR-6)
- **AC-FR-7:** When multiple devices are detected, the CLI MUST present an interactive prompt AND accept `--device <serial>` for non-interactive use. (covers FR-7)
- **AC-FR-8:** The CLI MUST print success or failure on every run with the failure reason. Exit code MUST be 0 on success, non-zero on failure. (covers FR-8)
- **AC-FR-9:** The payload MUST register for all three Solana chains (mainnet-beta, devnet, testnet) in a single injection. (covers FR-9)
- **AC-FR-10:** The payload MUST derive appIdentity from `document.title`, `window.location.origin`, and favicon. (covers FR-10)
- **AC-FR-11:** The build MUST produce both `mwa-inject.min.js` (minified) and `mwa-inject.js` (debug with readable names). (covers FR-11)
- **AC-FR-12:** The project MUST include a test HTML page that displays registered wallets via the wallet-standard event system. (covers FR-12)
- **AC-FR-13:** The minified payload MUST be executable by pasting into a Chrome DevTools console, producing the same result as automated injection. (covers FR-13)

### AC-A: Architecture Criteria

- **AC-A-1:** The CLI MUST register signal handlers (SIGINT, SIGTERM) and clean up all `adb forward` port mappings on normal and abnormal exit.
- **AC-A-2:** CDP tab discovery MUST retry at least 3 times with exponential backoff before failing, logging each attempt.
- **AC-A-3:** CDP port forwarding MUST use an ephemeral port, bind to localhost only, and tear down after injection or on error.
- **AC-A-4:** After Runtime.evaluate, the CLI MUST inspect the CDP response for exceptionDetails and report payload-level failures with non-zero exit code.
- **AC-A-5:** (SHOULD) The payload SHOULD probe for CSP restrictions on `ws://localhost` and log a warning if blocked.
- **AC-A-6:** The build script MUST emit bundle size and fail the build if the minified payload exceeds 150,000 bytes.

### AC-D: Developer/Maintainer Criteria

- **AC-D-1:** All non-trivial CLI logic (device detection, tab discovery, CDP communication) MUST be in a testable language (JS/TS with Node.js); shell scripts limited to delegation only.
- **AC-D-2:** All failure modes MUST be defined in a single error-catalog module with distinct error codes. No inline error messages outside the catalog.
- **AC-D-3:** Pure logic modules (guard, config, chain setup) MUST have unit tests with >= 80% line coverage. Test runner MUST be specified.
- **AC-D-4:** The idempotency flag name MUST be a named constant in a single source file, exported for reuse. No string literal of the flag name outside the definition file.
- **AC-D-5:** Bundle size assertion MUST be automated in the build script. (merged with AC-A-6)
- **AC-D-6:** The tab selection heuristic MUST be documented as a design decision in code comments or ADR.
- **AC-D-7:** The CLI MUST support a `--verbose` flag enabling debug-level logging of ADB commands and CDP messages to stderr.
- **AC-D-8:** The project MUST specify formatter, linter, and test runner in package.json scripts before implementation begins.

### AC-NFR: Non-Functional Criteria

- **AC-NFR-1:** The minified payload MUST be < 150,000 bytes, verified by the build script on every build. (covers NFR-1)
- **AC-NFR-2:** The payload MUST execute without errors on Chrome 100+ on Android. (covers NFR-2)
- **AC-NFR-3:** The CLI and payload MUST function identically on physical devices and emulators. (covers NFR-3)
- **AC-NFR-4:** The build MUST complete on Node.js >= 18; minimum version specified in package.json engines field. (covers NFR-4)
- **AC-NFR-5:** The minified payload MUST be a single JS file with zero import/require statements and zero external runtime dependencies. (covers NFR-5)

## Traceability Matrix

| Requirement | Covered By |
|---|---|
| FR-1 | AC-FR-1, AC-D-1 |
| FR-2 | AC-FR-2, AC-U-7 |
| FR-3 | AC-FR-3, AC-U-2, AC-U-6, AC-A-5 |
| FR-4 | AC-FR-4, AC-D-4, AC-D-3 |
| FR-5 | AC-FR-5, AC-A-1, AC-A-3 |
| FR-6 | AC-FR-6, AC-U-1, AC-A-2, AC-D-6 |
| FR-7 | AC-FR-7, AC-U-5 |
| FR-8 | AC-FR-8, AC-U-2, AC-U-4, AC-A-4, AC-D-2, AC-D-7 |
| FR-9 | AC-FR-9, AC-D-3 |
| FR-10 | AC-FR-10, AC-D-3 |
| FR-11 | AC-FR-11 |
| FR-12 | AC-FR-12, AC-U-3 |
| FR-13 | AC-FR-13 |
| NFR-1 | AC-NFR-1, AC-A-6, AC-D-5 |
| NFR-2 | AC-NFR-2 |
| NFR-3 | AC-NFR-3 |
| NFR-4 | AC-NFR-4, AC-D-8 |
| NFR-5 | AC-NFR-5 |

## Content Quality

| Check | Result |
|-------|--------|
| CQ-1 Density | PASS — No filler phrases; FRs are concise Capability Contracts |
| CQ-2 Impl Leakage | PASS — No tech names in FR text |
| CQ-3 Measurability | PASS — All NFRs have numeric targets |
| CQ-4 Traceability | PASS — 13/13 FRs → ≥1 AC, 5/5 NFRs → ≥1 AC, 0 orphans |

## Constraints & Assumptions

### Constraints
- C-1: HTTPS required — the wallet registration library requires a secure context
- C-2: Android-only — the wallet registration library requires an Android user agent
- C-3: Chrome 100+ required — target browser for DevTools remote debugging and CDP
- C-4: No persistence across page reloads — injection must be re-executed after each full page load
- C-5: Subject to page CSP — if a dApp blocks local WebSocket connections, the connect flow will fail
- C-6: Bundler is esbuild [LOCKED — DD-1]
- C-7: No web3.js runtime dependency [LOCKED — DD-2]
- C-8: Idempotency via a global window flag [LOCKED — DD-3]
- C-9: No user-agent spoofing [LOCKED — DD-4]
- C-10: All three chains registered (mainnet, devnet, testnet) [LOCKED — DD-5]
- C-11: App identity derived from page context [LOCKED — DD-6]
- C-12: Node.js >= 18 for build toolchain
- C-13: `adb` must be installed on the host machine for automated injection
- C-14: Chrome DevTools Protocol (CDP) used for automated payload delivery [LOCKED — DD-7]

### Assumptions
- A-1: Target third-party dApps use the wallet-standard event system for wallet discovery — Risk if wrong: injected wallet will not appear in their picker
- A-2: Target dApps do not block local WebSocket connections via CSP — Risk if wrong: MWA connect flow will fail after injection
- A-3: QA Engineers have `adb` installed and USB debugging enabled — Risk if wrong: script cannot connect to device
- A-4: Bundle size will fall within the estimated 80-120 KB range — Risk if wrong: dependency changes could push bundle over 150 KB limit
- A-5: Chrome on Android exposes CDP via `adb forward` to `localabstract:chrome_devtools_remote` — Risk if wrong: automated injection would not work; fallback to manual paste

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| dApp CSP blocks ws://localhost | MED | Not injection-specific; document as known limitation (AC-U-6). Payload CSP probe (AC-A-5) |
| Bundle size exceeds 150 KB | LOW | Build-time assertion (AC-A-6, AC-D-5). Current estimate 80-120 KB |
| CDP API changes across Chrome versions | LOW | Target Chrome 100+ with stable Runtime.evaluate; document minimum version |
| wallet-standard event system not present on target dApp | MED | Fundamental assumption (A-1); test on major dApps before release |
| adb forward port conflicts | LOW | Ephemeral ports (AC-A-3) + cleanup on exit (AC-A-1) |

## Out of Scope
- Browser extension packaging — Chrome on Android does not support extensions
- Userscript/Tampermonkey approach — Would require Firefox
- Custom WebView Android application — Exceeds scope; registerMwa() blocks WebView contexts
- Persistence across page reloads — Not needed for testing workflow
- iOS support — MWA is Android-only
- Automated end-to-end test suites — Testing is manual by design
- Performance optimization beyond bundle size — No runtime performance targets needed

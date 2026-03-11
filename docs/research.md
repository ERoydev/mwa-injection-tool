---
status: complete
created: 2026-03-11T09:58:20.000Z
feature: injection-tool
---
# Brief: MWA Standard Wallet Injection Tool

## Problem
Solana Mobile's MWA (Mobile Wallet Adapter) only works on dApps that explicitly integrate `@solana-mobile/wallet-standard-mobile`. Third-party dApps like Marinade, Jupiter, and Raydium don't include it, so MWA-compatible wallets never appear in their wallet picker on Android mobile browsers. There is currently no way to test MWA wallet flows on these dApps without modifying their source code.

## Vision
A single self-contained JavaScript payload that can be pasted into Chrome DevTools on a USB-connected Android device or emulator, injecting the MWA wallet registration into any Solana dApp page. The wallet appears in the dApp's picker immediately, enabling full MWA testing without any dApp cooperation, device modification, or alternate browser.

## Users
- **Solana Mobile QA Engineer / Developer**: Tests MWA compatibility on third-party dApps. Familiar with ADB, Chrome DevTools remote debugging, and USB debugging workflows. Needs a reproducible, zero-setup injection method that works on both physical devices and emulators.

## Success Metrics
- Functionality: Injected wallet appears in the dApp's wallet picker and completes the MWA connect flow on at least 3 major Solana dApps (e.g., Marinade, Jupiter, Raydium)
- Bundle size: < 150KB minified (functional constraint, not a performance goal)

## Scope
### In Scope
- Self-contained IIFE JavaScript payload (`mwa-inject.js`) bundling `registerMwa()` and all dependencies
- esbuild-based build system producing minified + debug outputs
- Idempotent injection (safe to run multiple times)
- Console logging for success/failure feedback
- ADB helper shell script (`inject.sh`) for device detection and port forwarding
- Minimal test HTML page for verifying wallet registration
- Documentation (README with quick start, troubleshooting)

### Out of Scope
- Browser extensions (Chrome Android doesn't support them)
- Tampermonkey / userscript approaches (would require Firefox)
- Custom WebView Android app
- Persistence across page reloads (not needed for testing workflow)
- iOS support (MWA is Android-only)
- Automated test suites running the injection
- Performance optimization beyond functional bundle size constraint

## Constraints
- HTTPS required — `registerMwa()` checks `window.isSecureContext` (all Solana dApps use HTTPS)
- Android-only — UA detection gates registration (passes naturally on real devices/emulators)
- Chrome 100+ — target browser for DevTools remote debugging
- Node.js >= 18 — build toolchain requirement
- USB Debugging must be enabled on device (standard for QA/testing workflows)
- Must re-inject on each page load (no persistence mechanism)
- Subject to page's CSP — `ws://localhost:*` must not be blocked (most Solana dApps allow this)

## Design Decisions
- DD-1: Use esbuild as bundler (over Rollup) — faster, simpler config, equivalent IIFE output [LOCKED]
- DD-2: No `@solana/web3.js` dependency — `@solana-mobile/wallet-standard-mobile` avoids it at runtime, keeping bundle small [LOCKED]
- DD-3: Idempotency via `window.__MWA_INJECTED__` global flag rather than querying wallet registry (avoids importing `@wallet-standard/app`) [LOCKED]
- DD-4: No UA spoofing — `registerMwa()` Android check passes naturally on target devices [LOCKED]
- DD-5: Register all three chains (mainnet, devnet, testnet) so injection works regardless of dApp's chain [LOCKED]
- DD-6: Derive `appIdentity` from page context (`document.title`, `location.origin`) rather than hardcoding [LOCKED]

## Additional Context

### Wallet Standard Event System
Registration is order-independent via a two-event handshake. Late injection works — if `registerMwa()` is called after the dApp has mounted, the dApp's `getWallets()` listener receives a `register` event and React state updates reactively. The wallet appears in the picker immediately.

### `registerMwa()` Internals
Three-step gate before registration:
1. `typeof window !== 'undefined'` — SSR guard (always passes in browser)
2. `window.isSecureContext` — HTTPS required
3. Platform detection — must be Android (UA sniff) AND not a WebView

Config parameters: `appIdentity`, `authorizationCache` (localStorage-based), `chains`, `chainSelector` (mainnet-first default), `onWalletNotFound` (error modal).

### Dependency Tree (No web3.js)
- `@solana-mobile/mobile-wallet-adapter-protocol` — WebSocket + ECDH + JSON-RPC
- `@wallet-standard/wallet` — `registerWallet()` (tiny)
- `@wallet-standard/base`, `@wallet-standard/features` — types
- `@solana/wallet-standard-chains`, `@solana/wallet-standard-features` — constants
- `bs58` v6 — Base58 encoding (~2KB)
- `js-base64` — Base64 (~5KB)
- `qrcode` — QR generation (~33KB, remote mode only)
- `tslib` — TS runtime helpers

Estimated bundle: ~80-120KB minified, ~25-40KB gzipped.

### MWA Local Association Flow
1. Library opens WebSocket to `ws://localhost:<random-port>/solana-wallet` (port 49152-65535)
2. ECDH P-256 key exchange + AES-128-GCM encryption
3. Library fires Android intent `solana-wallet://` to open wallet app
4. Wallet app binds to WebSocket, user approves in wallet UI
5. Auth token returned, dApp connected. Timeout: 30 seconds.

### CSP Considerations
WebSocket to localhost needs `connect-src ws://localhost:*`. Injected code runs in page context and is subject to page CSP. However, if a dApp blocks `ws://localhost:*`, it would also block MWA even with native integration — not injection-specific.

### DOM Side Effects
MWA library injects modal HTML (loading spinner, permission explainer, error modal, QR code modal). Styling is inline so it works regardless of page CSS.

### Chrome DevTools Snippets
Snippets persist across sessions and can be run with Ctrl+Enter. For remote debugging, snippets created on desktop sync to the remote device's DevTools session — eliminates re-pasting.

### Source Structure
```
src/
├── index.ts    — Entry point: guard checks + registerMwa() call
├── config.ts   — Build default config from page context
└── guard.ts    — Idempotency check + environment validation
```

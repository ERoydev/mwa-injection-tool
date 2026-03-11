# MWA Injection Tool

Injects a [Wallet Standard](https://github.com/wallet-standard/wallet-standard)-compatible MWA (Mobile Wallet Adapter) wallet into any Solana dApp running in Android Chrome, via the Chrome DevTools Protocol.

## Prerequisites

- **Node.js 18+**
- **ADB** (Android Debug Bridge) — install via [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) or `brew install android-platform-tools`
- **USB Debugging enabled** on the Android device/emulator — Settings → Developer Options → USB Debugging
- **Chrome** open on the Android device with a Solana dApp loaded

> **Note:** The `inject.sh` wrapper auto-detects ADB at common locations (`$ANDROID_HOME/platform-tools`, `~/Library/Android/sdk/platform-tools`, `~/Android/Sdk/platform-tools`). If ADB is installed elsewhere, set `ANDROID_HOME` in your shell profile:
> ```bash
> export ANDROID_HOME="$HOME/Library/Android/sdk"
> export PATH="$ANDROID_HOME/platform-tools:$PATH"
> ```

Verify ADB sees your device:

```bash
adb devices
# Should list your device/emulator, e.g.:
# emulator-5554   device
```

## Quick Start

```bash
# Install dependencies
npm install

# Build the payload and CLI
npm run build

# Inject into the active Chrome tab
./scripts/inject.sh
```

On success you'll see:

```
Device: emulator-5554 (emulator: sdk_gphone64_arm64)
Tab: Jupiter (https://jup.ag)
✓ Wallet registration confirmed
```

## Usage

```
Usage: mwa-inject [options]

Options:
  -d, --device <serial>  Target device serial (default: auto-detect)
  -v, --verbose          Enable debug logging to stderr
      --no-reload        Use Runtime.evaluate instead of inject-before-load
  -h, --help             Show this help message
```

### Examples

```bash
# Basic injection (auto-detect device, inject-before-load)
./scripts/inject.sh

# Target a specific device
./scripts/inject.sh --device emulator-5554

# Debug mode — see ADB commands, CDP messages, tab heuristic
./scripts/inject.sh --verbose

# Late injection without reloading the page
./scripts/inject.sh --no-reload

# Combine flags
./scripts/inject.sh --device emulator-5554 --no-reload --verbose
```

## Injection Modes

### Default: Inject Before Load (recommended)

Uses `Page.addScriptToEvaluateOnNewDocument` to register the payload script, then reloads the page. The wallet is available **before** the dApp's JavaScript executes, so wallet-adapter discovery finds it immediately.

```
registerScript → reload → dApp loads with wallet already present
```

Use this mode when you can afford a page reload — it guarantees the wallet is registered before any wallet-standard discovery runs.

### Fallback: `--no-reload` (late injection)

Uses `Runtime.evaluate` to execute the payload in the current page context without reloading. The wallet registers after the dApp has already loaded.

```
evaluate payload → wallet registers → dApp may need manual refresh of wallet list
```

Use this mode when:
- You want to preserve page state (e.g., a filled form, an active WebSocket connection)
- The dApp re-scans for wallets on user interaction (e.g., clicking "Connect Wallet")
- You're debugging and don't want to lose console history

## Testing with test-dapp.html

A test page is included at `test/test-dapp.html` for verifying injection in a controlled environment.

### Serving over HTTPS on Android

The MWA payload requires a secure context (HTTPS). To serve the test page to an Android device:

1. **Start a local HTTPS server** (using any tool that generates a self-signed cert):

   ```bash
   # Using npx serve with HTTPS
   npx serve test --ssl-cert cert.pem --ssl-key key.pem --listen 3000

   # Or using Python
   python3 -c "
   import ssl, http.server
   ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
   ctx.load_cert_chain('cert.pem', 'key.pem')
   server = http.server.HTTPServer(('0.0.0.0', 3000), http.server.SimpleHTTPRequestHandler)
   server.socket = ctx.wrap_socket(server.socket)
   server.serve_forever()
   " &
   ```

2. **Forward the port to the device:**

   ```bash
   adb reverse tcp:3000 tcp:3000
   ```

3. **Open the test page in Chrome on the device:**

   Navigate to `https://localhost:3000/test-dapp.html` and accept the self-signed certificate warning.

4. **Run the injection:**

   ```bash
   ./scripts/inject.sh --verbose
   ```

5. **Verify:** The test page will display "MWA" in the registered wallets list and show `[MWA Inject]` log entries in the on-page console panel.

## CSP (Content Security Policy) Considerations

Some dApps use strict Content Security Policies that may interfere with WebSocket connections or script evaluation.

### Symptoms

- `Refused to connect to 'ws://localhost:...'` errors in DevTools console
- The injection succeeds but the wallet can't communicate with the native MWA app

### Diagnosis

1. Open Chrome DevTools on the device: `chrome://inspect`
2. Check the Console tab for CSP violation messages
3. Look for `connect-src` directives that block `ws://localhost:*`

### Mitigation

This is a known limitation of CSP — it is **not specific to the injection tool**. The dApp's CSP policy controls what connections are allowed. Options:

- Test on dApps with permissive CSP policies (most Solana dApps allow WebSocket connections)
- Use the test-dapp.html page (no CSP restrictions) for controlled testing
- Contact the dApp developer if you need CSP exceptions for testing

## Project Structure

```
src/
  payload/          # Browser-side injection payload (IIFE bundle)
    guard.ts        # Environment checks (Android, secure context, duplicate)
    config.ts       # Wallet metadata and MWA constants
    index.ts        # Wallet registration via wallet-standard
  cli/              # Node.js CLI tool
    device.ts       # ADB device detection and selection
    cdp.ts          # Chrome DevTools Protocol client
    errors.ts       # Typed error catalog with remediation messages
    logger.ts       # Structured logger (info/debug/error/success)
    index.ts        # CLI orchestrator (main entry point)
scripts/
  build.mjs         # esbuild configuration (payload + CLI)
  inject.sh         # Shell wrapper for the CLI
test/
  test-dapp.html    # Static test page for injection verification
dist/               # Build output (gitignored)
  mwa-inject.min.js # Minified payload bundle
  cli.js            # Bundled CLI
```

## Development

```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Format check
npm run format

# Run tests
npm test

# Build everything
npm run build
```

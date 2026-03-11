---
feature: injection-tool
created: 2026-03-11T11:25:00.000Z
---
# Amendments: MWA Standard Wallet Injection Tool

## A-1: Primary injection strategy changed to inject-before-load
- Story: N/A (discovered during planning)
- Date: 2026-03-11T11:25:00.000Z
- Original: architecture.md Workflow 1 uses `Runtime.evaluate` to inject payload into the already-loaded page (late injection). Assumes wallet-standard event system reactively updates the dApp's wallet picker.
- Actual: Primary strategy uses `Page.addScriptToEvaluateOnNewDocument` to register the payload for execution before page scripts, followed by `Page.reload`. This ensures `registerMwa()` runs before the dApp's wallet adapter initializes. `Runtime.evaluate` becomes a fallback for cases where reload is undesirable (e.g., SPA with form state).
- Rationale: Real-world testing showed that some dApps snapshot wallets at mount time and don't react to late wallet-standard `register` events. Injecting before the dApp JS loads guarantees the wallet is present when the adapter first enumerates.

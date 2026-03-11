---
id: "3-1"
slug: test-dapp-page
title: "Test dApp HTML Page"
size: S
status: done
wave: 3
dependencies: ["1-2"]
---

# Story 3-1: Test dApp HTML Page

## User Story
As a QA Engineer, I want a test HTML page that displays registered wallets, so that I can verify the injection works in a controlled environment before testing on production dApps.

## Acceptance Criteria
- AC-1: Given `test/test-dapp.html` exists, When opened in a browser, Then it listens for `wallet-standard:register-wallet` events and displays each registered wallet's name in a visible list
- AC-2: Given the test page is open on an Android device over HTTPS, When the injection script is run, Then "MWA" (or the wallet's registered name) appears in the wallet list without a page reload
- AC-3: Given the test page is open over HTTP, When the payload is injected, Then the page shows the guard's `"not_secure_context"` skip reason (via console output visible to the user)

## Tasks
- [x] Task 1: Create `test/test-dapp.html` with wallet-standard listener, secure context indicator, and console log capture
  - Maps to: AC-1, AC-2, AC-3
  - Files: `test/test-dapp.html` (created)

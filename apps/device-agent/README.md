# dsh-device-agent

English | [中文](README.zh.md)

The local Device Plane process accepts only unconsumed operation permits signed by DSH Server. Browser and desktop Adapters execute within the local user's OS authorization.

The first adapters are Cua for desktop work, agent-browser with an isolated browser profile, and Playwright MCP for compatibility. The Agent never uploads cookies, passwords, clipboard contents, or full screen recordings. It returns bounded operation summaries and evidence hashes.

Build and start it with:

```bash
pnpm --filter @deepseek-ai/dsh-device-agent bundle
node apps/device-agent/lib/bin.js --server https://your-dsh-host
```

Then open **Digital employees → My devices → Connect this computer**. Pairing is handled through loopback and requires no device ID or key entry.

Repeated completion for the same challenge and device succeeds without restarting the connection. Concurrent matching requests share one save; a different device receives HTTP 409. A failed save returns HTTP 503 with `pairing_completion_failed` and may be retried. The configured DSH origin and matching challenge remain required for every completion.

`GET /v1/status` is restricted to the configured DSH origin. It reports protocol and agent versions, operating system, a saved connection for this server, browser installation presence, SDK import availability, and existing macOS Accessibility and Screen Recording grants. SDK `ready` means import succeeded; it does not mean desktop actions are authorized. This read-only check does not start a driver, request grants, capture the screen, or return device identifiers, identity keys, challenges, local paths, or environment values. Non-macOS permission status is `unsupported`; failed probes report `unknown` or `failed` with safe diagnostic codes. A missing or failed status provider returns HTTP 503 with `diagnostics_unavailable`.

Loopback requests are limited to 1 MiB and reject larger bodies with HTTP 413. Pairing completion requires JSON content type and rejects other media types with HTTP 415.

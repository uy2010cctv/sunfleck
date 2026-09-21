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

# Agent Note: Device browser executable discovery

Status: implemented

English | [中文](2026-09-12-device-browser-path.zh.md)

## Problem

The macOS LaunchAgent intentionally runs with a minimal system `PATH`. Browser Adapters spawned `agent-browser` and `playwright-mcp` by bare command name, so both failed with `ENOENT` even though their packages were installed.

## Decision

`dsh-device-agent` owns both browser runtimes as dependencies and resolves their package-local CLI entrypoints. It launches each CLI through `process.execPath`, so the service environment does not need a user shell or version-manager path. When an installed Chrome executable is available, both adapters use it with an isolated automation profile; administrators can override discovery with `DSH_DEVICE_BROWSER_EXECUTABLE`.

## Alternatives considered

**Add the user's Node directory to the LaunchAgent `PATH`.** This is machine-specific, couples the service to a version manager, and still leaves package-local Playwright MCP unresolved on other installations.

**Download a second browser unconditionally.** This adds a large network-dependent setup step even when a supported Chrome installation already exists.

## Consequences

Browser execution survives minimal service environments and reuses the existing browser binary without reusing the user's browser profile. Packaged Device Agents must include both CLI dependencies. Managed hosts with a nonstandard browser locations must set the explicit override.

## Verification

Regression tests run with package-local invocations. A macOS smoke test with a system-only `PATH` opened and snapshotted Example Domain through both Agent Browser and Playwright MCP.

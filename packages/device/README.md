---
description: "Package map for permit-gated browser and desktop actions executed on a user's paired computer."
kind: "package-group"
---

# device/ — paired user-computer execution

English | [中文](README.zh.md)

## Summary

The device family exposes a model tool that submits fixed, governed operations to the Device Plane. Server policy and durable records remain authoritative; execution occurs only on the paired user's local Device Agent.

## Packages

| Package | Role |
|---|---|
| [`tool-computer-use/`](tool-computer-use/README.md) | Model-facing fixed operation mapper and result waiter |

## Related documentation

The [Device Plane subsystem](../../docs/subsystems/device-plane.md) owns pairing, transport, execution, and audit guarantees.

## Dev Note

None.

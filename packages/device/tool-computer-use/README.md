---
description: "Model-facing Computer Use tool for fixed operations on the authenticated user's paired device."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-computer-use

English | [中文](README.zh.md)

## Summary

`computer_use` maps a small model-visible vocabulary to typed Device Plane actions. It resolves the Session owner and Workspace on the Host, selects an online device owned by that user, creates a confirmation-scoped run, and returns only the persisted result summary and evidence hash.

## Table of Contents

- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Dev Note

See the [Device Plane Agent Note](../../../.agents/notes/implemented/feature/2026-09-11-device-plane.md).

## Model Experience

### Computer Use tool

#### What the model sees

The model sees `screen_size`, browser open, snapshot, click, and fill. Arbitrary shell arguments, local paths, browser profiles, credentials, and device identifiers are not parameters. Control operations still require local confirmation.

#### Token effect

The fixed tool schema contributes a stable request cost while enabled. Each call retains its typed arguments and bounded result summary; screen content and local credentials are not added to model history.

#### KV Cache effect

The schema remains prefix-stable while the plugin configuration and tool visibility are unchanged. Action results append to history without rewriting the earlier request prefix.

## Known Limitations and Deferred Work

- Desktop support currently exposes connection-safe observation only.
- A tool call selects the most recently online owned device; explicit multi-device selection is deferred to a user-facing chooser.
- A result timeout reports the persisted action state and never retries an ambiguous external action.

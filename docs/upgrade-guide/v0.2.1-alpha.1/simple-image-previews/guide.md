---
kind: upgrade-guide
description: "Standalone simple image tags render as images rather than literal HTML text."
---
# Standalone image previews

English | [中文](guide.zh.md)

## Change

A standalone `img` tag with only `src`, `alt`, `title`, `width`, and `height` attributes renders as a Markdown image after settlement. Duplicate or other attributes, code examples, and unsupported protocols remain inert. The owner’s existing file resolver and authentication still apply. Width and height attributes do not control layout. Clickable images use contained 240px previews and open the shared original-image dialog.

## Migration

1. Use Markdown image syntax for new messages. Wrap an HTML image example in a code fence when it should remain source text.
2. Keep local image paths relative to the viewed workspace or absolute; local files must still exist and be accessible through the configured filesystem.
3. Verify that an existing simple image tag shows a thumbnail and opens its original when clicked. See the [Markdown renderer](../../../../packages/client/ui-primitives/README.md#rendering-agent-output).

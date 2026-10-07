---
kind: upgrade-guide
description: "Channels keep an explicitly published body instead of adding a completed-turn receipt."
---
# Channel posts replace completed-turn receipts

English | [中文](guide.zh.md)

## Change

When a channel employee successfully commits `room_post` during a completed native turn, the Host uses that body as the channel reply and skips the additional assistant completion receipt. Direct calls and nested PTC calls use their durable publication records. A failed publication, an unsuccessful turn, or a turn without `room_post` retains its native reply. Group replies retain their existing behavior. Native Session messages and existing signed room events remain stored.

Presented files from that turn associate with its last committed body through `replySourceSeq`, including files declared after the body was posted.

## Migration

1. Consumers of channel event pages should process the published body as the employee reply rather than wait for a second completion message.
2. Associate presented files using their returned `replySourceSeq`; this may identify the native `room_post` call rather than the last assistant message.
3. Confirm that a completed channel turn with a committed body produces one body with its files, while a failed publication still exposes the native reply. See the [room API reference](../../../../packages/api/enterprise-controller/README.md).

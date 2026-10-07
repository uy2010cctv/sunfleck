---
kind: upgrade-guide
description: "Human room-event reads return committed facts immediately while native-history repair runs asynchronously."
---
# Room-event repair runs asynchronously

English | [中文](guide.zh.md)

## Change

`GET /enterprise/surfaces/:id/events` returns committed signed room events while native-history repair runs asynchronously. Readers that relied on the request waiting for recovery must keep polling to receive newly recovered replies, tools, and Team facts. The response adds `reconciling`, which reports an active repair or revision check at response time. Existing event identities, ordering, cursors, and authorization checks retain their semantics.

## Migration

1. In clients of `/enterprise/surfaces/:id/events`, render returned `items` immediately and use `reconciling` for an in-progress repair indicator.
2. Keep cursor polling active while the room is open, using `after` with the last accepted `nextCursor`; merge events by their existing identities. The repair flag reports active work at response time, so polling remains necessary after it becomes false.
3. Confirm that opening a room with delayed recovery shows committed messages immediately, then adds recovered facts during a later poll without duplicates. See the [room API reference](../../../../packages/api/enterprise-controller/README.md).

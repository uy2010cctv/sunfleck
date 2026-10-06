---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-06-sunfleck-enterprise-attribution

English | [中文](2026-10-06-sunfleck-enterprise-attribution.zh.md)

## Summary

The SUNFLECK enterprise extensions retain their existing V4 events and message metadata alongside the v0.2.1-alpha.1 source inventory.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-sunfleck-enterprise-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "0e4c8531824dd258497f00bfe9c58cd36615eda1af3d8bee31781908e6bd9976"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "e00a17c8c9f292e386a0d632445fc80684956b96c6566de786959dddace464f7"
    decision: same-version
  - root: "event:enterprise-employee/cleared"
    previous: null
    after: "d33ca6545c96f315b2d974b406da301ba6a95f48f72f5c96ae866dbed0c53ff0"
    decision: same-version
  - root: "event:enterprise-employee/selected"
    previous: null
    after: "4fe6b7e13d860d7a6f53e3ea9c94423de599918db85b82e1ab66cfb7270a709c"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "39d3daf900d452dea33ce71719d31cba2f7d1f61395f15f8a4641705e4ffaf44"
    decision: same-version
  - root: "event:team/decision"
    previous: null
    after: "7252bdbf90e36cb0f03f4d42667d89b1df5547af7039e0b5de0718f03a9e7713"
    decision: same-version
  - root: "event:team/human-member"
    previous: null
    after: "c86d428141ee623497bdc58ee5eadfb9cd4b6d82aba214b501d407852b169762"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "336418fa3f10c534c1aebbb5cc5dbbc03124c4c85096e6270150bf5eda97d12e"
    decision: same-version
  - root: "event:team/run"
    previous: null
    after: "9da8235ff24f685b83d81ef83bb19b64c5ab4b963f290d05834fd37c2dcd2975"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "94af482a2d5d9f2c47661a5d31197dba557dfcbc0fa2f28a725d19fdbaa383b0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The six enterprise producer labels attribute ordinary recorded message blocks; shared readers preserve unknown attribution kinds and their fields. Optional user-source routing fields do not replace message content. Enterprise employee selection, device attachment, and room delivery event roots remain owned by their existing plugins. The compatibility classifier reports no version-bump-required changes relative to the accepted V4 baseline. No committed Session generation or finalized acknowledgement is rewritten.

<a id="verification"></a>
## Verification

Host and Client TypeScript compilation passed. Enterprise, preset, and scheduling behavior tests passed after fixture repairs; the recorded group-schedule-cooperation scenario replayed through the shipped headless profile. The inventory was extracted from the merged source and checked against the accepted V4 baseline before authoring this successor.

<a id="dev-note"></a>
## Dev Note

None.

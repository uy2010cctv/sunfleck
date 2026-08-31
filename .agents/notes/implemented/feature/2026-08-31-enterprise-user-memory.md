# Agent Note: Enterprise private user memory

Status: implemented

English | [中文](2026-08-31-enterprise-user-memory.zh.md)

## Decision

DSH Enterprise memory has three inherited scopes: organization, department, and user. The Session owner binding is the current-user authority. User memory stores stable work preferences and is returned only when `ownerUserId` matches that Session owner; sharing a department or Workspace never grants access to another user's memory.

Automatic writes attribute `createdBy` to the Session owner and `reviewedBy` to the configured automation actor. User scope may retain a work preference that shared scopes reject as personal preference, while credentials, identifiers, contact data, prompt injection, raw customer content, and overlong summaries remain blocked in every scope.

Prompt assembly orders organization, department, then user memory and injects only approved summaries with stable ids. PostgreSQL and SQLite schema v6 add `owner_user_id`; previous organization and department rows migrate with a null owner without changing their meaning.

The governance memory page presents the three layers separately. Administrator queries include only the current administrator's private memory bodies, not other users' private records.

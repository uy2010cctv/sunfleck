---
kind: upgrade-guide
description: "Custom enterprise identity stores must implement the organization-scoped user lookup."
---
# Enterprise identity user lookup

English | [中文](guide.zh.md)

## Change

`EnterpriseIdentityStore` requires `findUserById(orgId, userId)`. Resource authorization reads one current human user through this method. Deployments supplying a custom `identityStore` must update their adapter; the shipped SQLite and PostgreSQL adapters implement it.

The optional `sessionAccessFacts` method supports bulk Session list authorization. Custom stores may omit it and retain individual access reads. Implementations must return current facts only for requested ids, including other-organization collaboration bindings for denial.

## Migration

1. Add `findUserById(orgId, userId)` to the custom `EnterpriseIdentityStore` implementation. Return the current `EnterpriseUserView`, including roles, departments and disabled state, or `undefined` when the user does not exist in the requested organization. A synchronous result or Promise is supported.
2. Read the current record on every call without caching permissions across requests.
3. Typecheck the adapter and verify that organization mismatch returns `undefined` and membership changes are visible on the next read.

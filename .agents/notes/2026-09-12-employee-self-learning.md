# Employee self-learning implementation plan

Goal: learned SOPs and skills register and bind to the owning employee without administrator confirmation.

Architecture: the independent learning entry of the enterprise context package contributes an explicit learning tool. The session supplies the employee and workspace identity. The catalog transaction owns asset creation, binding and release; prompt context reads learned content for this employee and workspace. Pending human profile edits remain drafts.

- [x] Test atomic learning, repeat calls, existing bindings and pending drafts.
- [x] Implement catalog transaction and session-derived learning tool.
- [x] Inject bounded learned instructions into employee sessions and test isolation.
- [ ] Verify source tests, deploy focused changes, and read back live results.

No new tool permissions, credentials or workspace grants are created by learning. Source files remain authoritative; learning stores a versioned text snapshot and source reference.

Validation: 28 focused tests including a real Loader composition; targeted TypeScript build and source lint; isolated real PostgreSQL schema verified asset/binding/release transaction, pending-draft preservation and idempotency. Review fixed preset projection ownership and PTC subcall idempotency. Deployment preserves the parallel runtime memory/auth changes by mounting a separate learning entry.

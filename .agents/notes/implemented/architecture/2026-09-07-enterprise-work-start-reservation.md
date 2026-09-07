# Agent Note: Enterprise work-start reservation

Status: implemented

English | [中文](2026-09-07-enterprise-work-start-reservation.zh.md)

## Problem

The former work-start flow created and bound a native Session before its WorkRecord idempotency write. A persistence failure left no durable admission evidence capable of stopping a changed retry from reaching native side effects.

## Decision

Enterprise Operations owns a PostgreSQL work-start reservation keyed by organization, user, and idempotency key. It stores the canonical request fingerprint plus the resolved Session, Workspace, release, preset, permitted deadline value/digest, and `starting` or `completed` lifecycle. The controller reserves before create/bind, uses the stored snapshot for retries, and marks completion only after the WorkRecord upsert.

## Alternatives considered

**WorkRecord-only idempotency.** It loses the admission boundary whenever its write fails after native Session side effects, so it cannot safely reject a changed retry.

**A new Remote namespace.** This would expose an internal recovery mechanism and widen the browser API; the existing `enterpriseWork.start` remains the only user-visible work-start method.

## Consequences

The reservation prevents a same-key request with changed canonical input from creating another Session, and a restart can finish a partial start using the same deterministic Session ID. It adds one durable lifecycle record per work start and intentionally does not claim exactly-once external effects: native create/bind must still tolerate retry of the stored Session ID.

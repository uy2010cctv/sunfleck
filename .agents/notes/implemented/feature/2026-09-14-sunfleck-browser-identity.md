# Agent Note: SUNFLECK browser identity

Status: implemented

English | [中文](2026-09-14-sunfleck-browser-identity.zh.md)
## Problem

The enterprise workbench needs one recognizable product identity across login, navigation, conversation, and browser installation without changing the DSH execution system underneath it.

## Decision

SUNFLECK is the browser product identity. The shared vector mark, Phudu wordmark, embedded typography, and paired light/dark semantic palettes follow the supplied identity assets. [Brand presentation](../../../../packages/client/ui-brand-official/README.md) keeps official-profile registration and third-party slot replacement; the default conversation hero uses the shared mark without fish morphing.

Backend package names, protocol fields, persisted identities, runtime behavior, and provider labels retain their technical meaning. Browser branding does not rename a model provider or create another employee, Session, permission, or audit authority.

## Alternatives considered

**Renaming backend identities with the product.** This expands a visual identity change into runtime and persisted-data changes without improving the interface.

**Replacing only the sidebar artwork.** Login, browser installation, the conversation hero, and action colors would present conflicting identities.

## Consequences

The frontend has a consistent identity while DSH retains execution ownership and extension behavior. The frontend assets and font licenses require maintenance together. Verification covers shared marks, both palettes, localized labels, browser metadata, and official-profile versus fallback rendering; runtime and provider names remain outside the branding replacements.

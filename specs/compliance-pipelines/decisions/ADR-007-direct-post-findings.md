# ADR-007: Direct POST Findings as Future Data Channel (Roadmap P2)

**Status:** Proposed (roadmap P2)
**Date:** 2026-05-26
**Deciders:** M. Ferrari, PM, architect

## Context

The current approach parses compliance findings from Controller job events (`runner_on_ok` / `runner_item_on_ok` events). This works but is fragile:

- Controller events were not designed for bulk data transfer
- Events have a ~200KB payload size limit, requiring slim findings (ADR-005)
- The backend must poll job events and parse specific task names to extract findings
- Any change in task naming or event structure breaks the pipeline

The PM and architect both recommend decoupling the data channel from Controller's event system.

## Decision

**Future implementation (P2):** Have the playbook POST findings directly to the plugin's REST API, bypassing Controller events entirely.

Implementation plan:
1. Add `/api/compliance/ingest` endpoint accepting CFF JSON + scanId
2. Add `uri` task in the normalize play to POST findings to the Backstage backend URL (passed as extra_var)
3. Remove dependency on parsing Controller job events for findings

Requirements:
- EE must have network access to Portal/Backstage backend
- Auth token must be passed to the playbook (extra_var or credential)
- Endpoint must validate scanId and reject duplicate submissions

The current slim-findings-via-events approach (ADR-005) remains the working implementation until direct POST is built.

## Consequences

- **Positive:** Decouples data channel entirely from Controller's event system.
- **Positive:** Works regardless of finding count -- no size limits.
- **Positive:** Testable in isolation (POST JSON to endpoint, verify storage).
- **Positive:** Full CFF metadata can be transmitted (no stripping needed).
- **Negative:** Requires EE network access to Portal/Backstage backend -- may not work in air-gapped environments without additional network configuration.
- **Negative:** Adds a new auth surface (playbook needs a token to POST to the plugin API).
- **Negative:** Two data channels during transition (events for backward compatibility, direct POST for new deployments).

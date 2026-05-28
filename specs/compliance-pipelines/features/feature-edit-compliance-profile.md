# Feature: Edit Compliance Profile

**Status:** Shipped (commits `91b6184`, `35e0625`, 2026-05-28)
**Jira:** ANSTRAT-2216
**Roadmap:** Discovered during manual testing of platform guards

## Problem

The Settings tab only supported Add and Delete for compliance profiles. Editing required deleting and recreating the profile, which meant losing the profile ID (breaking scan history associations) and re-entering all fields manually. This also blocked testing of other features — e.g., temporarily changing the Assessment JT ID to trigger a failed scan required a full delete/recreate cycle.

## Design Approach

- Reuse the existing Add dialog in edit mode — no new UI components
- Add `GET /cartridges/:id` backend route for fresh data fetch on edit click
- Use the existing `saveCartridge()` upsert logic in the backend (checks if ID exists, updates if so)
- Add `editingId` state to track create vs edit mode in the frontend
- Fetch fresh profile data on edit click via `getCartridge()` to detect stale/deleted profiles

### Stale Edit Guard

If a profile is deleted by another user while the edit dialog is about to open, `getCartridge()` returns null. The frontend refreshes the profile table and does not open a stale dialog. This was identified during architect review and fixed in `35e0625`.

### Alternatives Considered

- *Separate edit form:* Unnecessary — the add form has all the same fields
- *PUT endpoint:* Unnecessary — the POST upsert pattern is already established and the frontend simply includes the `id` field
- *Optimistic locking:* Overkill for a low-contention admin settings screen

## Implementation Scope

**Shipped:**
- Backend: `GET /cartridges/:id` route (read-only, no permission check — matches all other GET routes)
- Frontend API: `getCartridge(id)` method on `ComplianceBackendClient` and `ComplianceApi` interface
- Frontend UI: Edit icon button (pencil) next to Delete, form pre-populated on click, conditional dialog title ("Edit" vs "Add") and button label ("Update" vs "Save")
- `handleEditClick` fetches fresh data via `getCartridge()` before opening dialog
- `handleSave` includes `id` in the request payload when editing, triggering the backend upsert path
- 4 frontend tests: edit button visible, form pre-populated, save includes id, add mode shows Save
- 2 backend tests: GET returns 200 with cartridge, 404 when not found

**No database changes required** — the existing `saveCartridge()` upsert logic handles updates.

## Files Changed

| File | Change |
|------|--------|
| `plugins/compliance-backend/src/router.ts` | `GET /cartridges/:id` route |
| `plugins/compliance-backend/src/router.test.ts` | 2 tests for new route |
| `plugins/compliance/src/api/complianceApiRef.ts` | `getCartridge()` on interface |
| `plugins/compliance/src/api/ComplianceBackendClient.ts` | `getCartridge()` implementation |
| `plugins/compliance/src/components/CartridgeSettings/CartridgeSettings.tsx` | Edit button, form population, conditional labels, stale edit guard |
| `plugins/compliance/src/components/CartridgeSettings/CartridgeSettings.test.tsx` | 4 edit flow tests |
| `plugins/compliance/src/__testutils__/mockComplianceApi.ts` | Mock updated |
| 3 other test files | Mock stubs added |

## Testing

- Backend: GET /cartridges/:id — 200 with cartridge, 404 when missing
- Frontend: edit button visible, form pre-populated on click, save sends id, add mode shows Save button
- Architect review: all PASS after WARN fixes (stale edit guard, test coverage)
- 251 tests, 12 suites, all passing

## Dependencies

- ADR-011 (platform guards) — edit needed to modify platform spec fields after initial profile creation

## Deployment Notes

- No migrations
- No config changes
- Backend-only change for the route; frontend uses existing dialog

# RBAC Deep Dive: Ansible Portal Plugin Permission Model

**Source**: `ansible/ansible-rhdh-plugins` (via `ansible-backstage-plugins/` submodule)
**Date**: 2026-05-21
**Scope**: Actual implementation analysis, not documentation or aspirational design

---

## Executive Summary

The downstream Ansible Portal plugins implement a **two-tier permission model**: AAP superusers (via `aap-admins` group) get full admin access, and everyone else gets nothing by default. There is **no per-organization or per-team permission enforcement** in any plugin code. AAP organizations and teams are synced into Backstage as catalog entities with correct membership, but **zero permission decisions reference those memberships**. The RBAC infrastructure for granular team/org-scoped access exists in the plumbing but is completely unused.

---

## 1. Self-Service Plugin Permissions

### Permission Checks Found

The self-service plugin uses exactly **4 Backstage permissions** across all components:

| Permission | Where Used | What It Gates |
|---|---|---|
| `catalogEntityCreatePermission` | `Home.tsx`, `RouteView.tsx`, `CreateContent.tsx` | "Add Template" button, "Sync now" button, catalog-import route, EE "Import Template" kebab |
| `taskCreatePermission` | `TemplateCard/index.tsx`, `TemplateActions.tsx`, `RunTask.tsx` | "Start" button on template cards, "Launch" button on detail page, "Start Over" button on task page |
| `taskReadPermission` | `RouteView.tsx`, `RunTask.tsx` | Access to task list route, access to task detail route, log viewing |
| `taskCancelPermission` | `RunTask.tsx` | "Cancel" button on running tasks |
| `catalogEntityDeletePermission` | `TemplateActions.tsx` | "Unregister Template" button on template detail |

### What These Checks Actually Do

Every `usePermission` call checks a **global permission** -- none of them pass an entity-specific `resourceRef` that would enable per-resource decisions. The only exception is:

```typescript
// RouteView.tsx -- resourceRef is a static string, not a specific task ID
<RequirePermission permission={taskReadPermission} resourceRef="scaffolder-task">
```

```typescript
// RunTask.tsx -- resourceRef IS the task ID, enabling per-task decisions
const { allowed: canCancel } = usePermission({
  permission: taskCancelPermission,
  resourceRef: taskId,
});
```

**Key finding**: `taskCancelPermission` passes the actual `taskId` as a resource ref, which *could* enable per-task authorization (e.g., "only cancel your own tasks"). Whether this is enforced depends entirely on the RBAC policy backend configuration -- the plugin itself just passes the ref.

### Template Visibility: No Organization Scoping

The Home page (`Home.tsx`) displays templates using `TemplateGroups` with a filter function:

```typescript
filter: (entity: TemplateEntityV1beta3) => {
  // Filters out execution-environment types
  // Matches against job templates from AAP autocomplete
  return jobTemplates.some(({ id }) =>
    entity.metadata.aapJobTemplateId
      ? id === entity.metadata.aapJobTemplateId
      : true  // <-- If no aapJobTemplateId, show to everyone
  );
}
```

The `jobTemplates` list comes from the scaffolder autocomplete API, which fetches **all** job templates visible to the logged-in user's AAP token. The frontend does NOT filter by organization or team membership. If the AAP token has access to a template, it shows up for that user. But the **Backstage catalog query** that backs the `TemplateGroups` component is completely unscoped -- it returns all Template entities of any owner.

### Task List: Hardcoded Admin Group Check

The `TaskList.tsx` component has a particularly revealing pattern:

```typescript
const adminGroups = [
  'group:default/admins',
  'group:default/rbac_admin',
  'group:default/portal-admins',
  'group:default/portal_admins',
];
const isAdmin = identity.ownershipEntityRefs.some(ref =>
  adminGroups.includes(ref.toLowerCase()),
);
```

If the user is in one of these hardcoded admin groups, the task list shows ALL tasks (`filterByOwnership: 'all'`). Otherwise, it shows only the user's own tasks (`filterByOwnership: 'owned'`).

**Problem**: `aap-admins` is NOT in this hardcoded list. This is a bug -- AAP superusers who are in `group:default/aap-admins` would see only their own tasks despite being platform admins.

---

## 2. EE Build Plugin Permissions

There is no separate EE build plugin. EE functionality lives within the self-service plugin under `components/ExecutionEnvironments/`. The permissions it checks are:

- `catalogEntityCreatePermission` -- gates the "Import Template" kebab menu in `CreateContent.tsx`

The EE catalog view (`CatalogContent.tsx`) and detail page (`EEDetailsPage.tsx`) have **no permission checks** -- they display all EE entities from the catalog to all users.

---

## 3. Backend Permission Enforcement

### What the Backend Does NOT Do

Searching across all backend plugins for `permissions.authorize`, `httpAuth.credentials`, `AuthorizeResult`, or any conditional permission logic yields **zero results**. The backend plugins do not perform any server-side permission evaluation.

Specifically:

- **`catalog-backend-module-rhaap`** (`router.ts`): The sync endpoints (`/aap/sync_orgs_users_teams`, `/aap/sync_job_templates`, `/aap/create_user`) have **no authentication or authorization checks**. Any authenticated Backstage user could trigger a sync or create a user by calling these endpoints directly. The router relies entirely on Backstage's service-to-service auth for the `create_user` endpoint (the auth resolver generates a service token), but the sync endpoints are completely open.

- **`scaffolder-backend-module-backstage-rhaap`**: The scaffolder actions (launch job template, create project, create EE, etc.) use the **user's AAP OAuth2 token** for API calls to AAP. This means AAP's own RBAC controls what the user can do on the AAP side. But Backstage does not add any additional authorization layer -- if you have a valid AAP token and can hit the scaffolder action, it will execute.

### AAP-Side Authorization (Implicit)

The scaffolder actions pass the user's AAP access token to AAP API calls:

```typescript
// aapLaunchJobTemplate.ts
jobResult = await ansibleServiceRef.launchJobTemplate(values, token);
```

This means a user who doesn't have permission in AAP to launch a particular job template will get a 403 from AAP, which surfaces as a template execution error. The authorization is real but is entirely delegated to AAP -- Backstage doesn't pre-check it.

---

## 4. RBAC Policy Configuration

### Current Configuration (`app-config.yaml`)

```yaml
permission:
  enabled: true
  rbac:
    admin:
      users:
        - name: user:default/admin
        - name: group:default/aap-admins
      superUsers:
        - name: user:default/admin
        - name: group:default/aap-admins
    pluginsWithPermission:
      - catalog
      - scaffolder
      - permission
```

This means the RBAC backend evaluates permissions only for the `catalog`, `scaffolder`, and `permission` plugins. All other plugins have no permission restrictions.

### Default Policy CSV (`default-rbac-policy.csv`)

Two roles are defined:

**`role:default/aap-admins`** -- Full access to everything:
- catalog entity CRUD
- catalog location CRUD
- scaffolder template read, action execute, task CRUD + cancel
- permission CRUD
- policy entity CRUD

**`role:default/portal-users`** -- Read + execute access:
- catalog entity read
- scaffolder template read, action execute, task create/read/cancel

### What's Missing

There is **no role for**:
- Individual AAP organizations (e.g., `role:default/org-production`)
- Individual AAP teams (e.g., `role:default/devops-team`)
- Auditor/read-only access to specific resources
- Per-template or per-organization scoping

The `portal-users` role is defined but there is no group assignment to it except a single line:
```csv
g, group:default/portal-users, role:default/portal-users
```

This group (`portal-users`) is never created by the AAP entity sync. It would need to be manually created or mapped from an AAP organization/team.

---

## 5. AAP Gateway User Info

### What Comes Back from `/api/gateway/v1/me/`

```typescript
// AAPClient.ts fetchProfile()
{
  results: [{
    id: number,
    username: string,
    email: string,
    first_name: string,
    last_name: string
  }]
}
```

**Critical gap**: The `/me/` endpoint does NOT return:
- Organization membership
- Team membership
- Role assignments (admin/auditor/member)
- `is_superuser` flag

The profile endpoint returns only basic identity information. Organization and team memberships are fetched separately via:
- `/api/gateway/v1/users/{id}/organizations/` -- user's org memberships
- `/api/gateway/v1/users/{id}/teams/` -- user's team memberships
- `/api/gateway/v1/users/{id}/` -- includes `is_superuser` flag
- `/api/gateway/v1/role_user_assignments/` -- role assignments (Team Member, Organization Member, etc.)

### Auth Provider -> Backstage Identity Mapping

The auth provider maps AAP user data to a Backstage identity as follows:

1. User authenticates via OAuth2 and gets a `username` from the profile
2. The sign-in resolver looks up `user:default/{username}` in the catalog
3. If `allowNewAAPUserSignIn` resolver is used and the user doesn't exist, it calls `/aap/create_user` to create them
4. The user entity's `memberOf` list determines their group memberships

The PassportProfile returned by the auth flow contains:
```typescript
{
  provider: 'AAP oauth2',
  id: userData.id.toString(),
  username: userData.username,
  email: userData.email,
  displayName: `${first_name} ${last_name}`
}
```

**No organization/team/role information is included in the auth token or profile.** Group memberships come entirely from the catalog entity sync, not from the authentication flow.

---

## 6. The Key Question: Per-Organization/Team Access

### Does the self-service plugin enforce per-organization access?

**No.** There is zero organization-scoped access control anywhere in the codebase.

### Can User A (Org "Production") see User B's (Org "Development") templates?

**Yes.** All templates from all configured organizations are visible to all authenticated users. The template list is filtered by:
1. Whether the template has a matching AAP job template ID (via autocomplete API)
2. Whether the user's AAP token has visibility to that job template

Point 2 provides *implicit* AAP-side scoping, but it depends entirely on how AAP RBAC is configured. Backstage itself does not restrict visibility.

### Is it all-or-nothing?

**Effectively yes.** The current model has exactly two tiers:

| Tier | Who | What They Can Do |
|---|---|---|
| **Admin** | `aap-admins` group (AAP superusers) + `user:default/admin` | Everything: CRUD all entities, manage templates, sync, manage RBAC policies |
| **Everyone else** | Any authenticated user not in aap-admins | Read catalog, view templates, launch templates (if AAP token allows), view own tasks |

Non-admin users can still **launch** templates because the RBAC backend (when using the community RBAC plugin without explicit deny rules) may default to allowing scaffolder actions. The actual enforcement depends on whether deny-by-default is enabled.

### What Would Be Needed for Granular Access

The infrastructure is partially in place but unused:

1. **AAP orgs/teams ARE synced as Backstage groups** -- `organizationParser()` creates `Group` entities with `type: organization`, `teamParser()` creates `Group` entities with `type: team`, and user `memberOf` correctly reflects these memberships.

2. **Role assignments ARE fetched** -- `getUserRoleAssignments()` fetches roles like "Team Member", "Organization Member" from `/api/gateway/v1/role_user_assignments/`. But this data is **fetched and discarded** -- it is never used to create Backstage RBAC policies or group assignments.

3. **The RBAC CSV format supports org/team-level policies** -- you could write:
   ```csv
   p, role:default/org-production, catalog-entity, read, allow
   g, group:default/production, role:default/org-production
   ```
   But nobody does this, and there's no automation to generate these policies.

4. **Missing: Conditional/resource-scoped permissions** -- Even if org-level RBAC roles existed, the current permission checks in the self-service plugin are all global. To implement "User A can only see templates owned by Org Production", you would need:
   - Template entities to carry an `owner` field pointing to the org group
   - Permission checks that pass the template entity ref as a resource
   - A permission policy that evaluates ownership (Backstage supports this via `createConditionExports` but it's not implemented)

---

## Architectural Gap Summary

| Capability | Status | Evidence |
|---|---|---|
| AAP orgs synced as Backstage groups | Done | `organizationParser()` in `entityParser.ts` |
| AAP teams synced as Backstage groups | Done | `teamParser()` in `entityParser.ts` |
| User org/team membership preserved | Done | `userParser()` sets `memberOf` |
| AAP roles fetched | Done but unused | `getUserRoleAssignments()` fetches, result never used |
| `is_superuser` mapped to `aap-admins` group | Done | `createAapAdminsGroup()` in `AAPEntityProvider.ts` |
| Per-org RBAC policies | Not implemented | No policy generation, no org-scoped permission checks |
| Per-team RBAC policies | Not implemented | No policy generation, no team-scoped permission checks |
| Template visibility scoped by org/team | Not implemented | All templates shown to all users |
| Task visibility scoped by org/team | Partially (own vs all) | `TaskList.tsx` checks hardcoded admin groups |
| Conditional permission evaluation | Not implemented | No `createConditionExports`, no resource-scoped checks |
| Backend authorization on sync endpoints | Not implemented | `/aap/sync_*` endpoints have no auth checks |

---

## Files Referenced

**Self-service plugin (frontend permissions)**:
- `plugins/self-service/src/components/Home/Home.tsx` -- line 162-163
- `plugins/self-service/src/components/Home/TemplateCard/index.tsx` -- line 28-29
- `plugins/self-service/src/components/CatalogItemDetails/TemplateActions.tsx` -- line 23-28
- `plugins/self-service/src/components/RunTask/RunTask.tsx` -- lines 85-94
- `plugins/self-service/src/components/RouteView/RouteView.tsx` -- lines 28-57
- `plugins/self-service/src/components/ExecutionEnvironments/create/CreateContent.tsx` -- line 109-110
- `plugins/self-service/src/components/TaskList/TaskList.tsx` -- lines 135-148

**Auth provider (identity mapping)**:
- `plugins/auth-backend-module-rhaap-provider/src/resolvers.ts`
- `plugins/auth-backend-module-rhaap-provider/src/authenticator.ts`
- `plugins/auth-backend-module-rhaap-provider/src/module.ts`

**Catalog backend (entity sync)**:
- `plugins/catalog-backend-module-rhaap/src/providers/AAPEntityProvider.ts`
- `plugins/catalog-backend-module-rhaap/src/providers/entityParser.ts`
- `plugins/catalog-backend-module-rhaap/src/router.ts`

**AAP client (API integration)**:
- `plugins/backstage-rhaap-common/src/AAPClient/AAPClient.ts` -- `fetchProfile()`, `getOrganizations()`, `getUserRoleAssignments()`
- `plugins/backstage-rhaap-common/src/types/types.ts` -- `User`, `Team`, `Organization`, `RoleAssignment` types

**RBAC configuration**:
- `app-config.yaml` -- lines 159-178
- `default-rbac-policy.csv` -- full file

**App shell**:
- `packages/app/src/App.tsx` -- lines 128-136
- `packages/backend/src/index.ts` -- line 46

All paths relative to `ansible-backstage-plugins/`.

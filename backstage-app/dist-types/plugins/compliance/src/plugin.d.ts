import type { AapAuthApi } from './api/ComplianceBackendClient';
/**
 * Optional API ref for AAP authentication.
 *
 * When the compliance plugin runs inside the Ansible Portal (RHDH),
 * the Portal provides rhAapAuthApiRef which implements AapAuthApi.
 * The compliance plugin declares its own ref with the same ID so it
 * can optionally consume it without depending on
 * @ansible/plugin-backstage-self-service.
 *
 * If the API is not registered (standalone dev mode), the factory
 * falls back to undefined and the backend uses the service token.
 */
export declare const aapAuthApiRef: import("@backstage/frontend-plugin-api").ApiRef<AapAuthApi>;
export declare const compliancePlugin: import("@backstage/core-plugin-api").BackstagePlugin<{
    root: import("@backstage/core-plugin-api").RouteRef<undefined>;
}, {}, {}>;
export declare const CompliancePage: () => import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=plugin.d.ts.map
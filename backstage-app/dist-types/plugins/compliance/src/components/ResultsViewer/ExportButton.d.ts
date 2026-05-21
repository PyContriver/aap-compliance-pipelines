import type { MultiHostFinding } from '@aap-compliance/common';
interface ExportButtonProps {
    findings: MultiHostFinding[];
    profileName?: string;
}
/**
 * Generate a CKL (STIG Viewer Checklist) XML string from findings.
 *
 * CKL is the standard format used by DISA's STIG Viewer tool.
 * This generates a single CKL file for a specific host, containing
 * all VULN entries from the findings.
 */
export declare function generateCKL(findings: MultiHostFinding[], hostname: string, profileName: string): string;
export declare const ExportButton: ({ findings, profileName }: ExportButtonProps) => import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ExportButton.d.ts.map
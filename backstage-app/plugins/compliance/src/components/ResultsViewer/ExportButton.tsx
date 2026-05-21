/**
 * Export button for compliance findings.
 *
 * Supports CSV, JSON, and CKL (STIG Viewer) export formats.
 * Uses browser-native download (Blob + anchor click) -- no server-side
 * export needed.
 */
import React, { useState } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@material-ui/core';
import GetAppIcon from '@material-ui/icons/GetApp';
import DescriptionIcon from '@material-ui/icons/Description';
import CodeIcon from '@material-ui/icons/Code';
import AssignmentTurnedInIcon from '@material-ui/icons/AssignmentTurnedIn';
import type { MultiHostFinding } from '@aap-compliance/common';

interface ExportButtonProps {
  findings: MultiHostFinding[];
  profileName?: string;
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCSV(findings: MultiHostFinding[]): string {
  const headers = [
    'Rule ID',
    'STIG ID',
    'Title',
    'Severity',
    'Category',
    'Host',
    'Status',
    'Actual Value',
    'Expected Value',
  ];

  const rows: string[] = [headers.join(',')];

  for (const finding of findings) {
    for (const host of finding.hosts) {
      const row = [
        escapeCSVField(finding.ruleId),
        escapeCSVField(finding.stigId),
        escapeCSVField(finding.title),
        escapeCSVField(finding.severity),
        escapeCSVField(finding.category || ''),
        escapeCSVField(host.host),
        escapeCSVField(host.status),
        escapeCSVField(host.actualValue),
        escapeCSVField(host.expectedValue),
      ];
      rows.push(row.join(','));
    }
  }

  return rows.join('\n');
}

// ─── CKL (STIG Viewer / Checklist) generation ──────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Map our internal severity to CKL severity format.
 * CKL uses lowercase: high, medium, low.
 */
function toCklSeverity(severity: string): string {
  switch (severity) {
    case 'CAT_I': return 'high';
    case 'CAT_II': return 'medium';
    case 'CAT_III': return 'low';
    default: return 'medium';
  }
}

/**
 * Map our internal status to CKL STATUS values.
 * CKL uses: NotAFinding, Open, Not_Reviewed, Not_Applicable.
 */
function toCklStatus(status: string): string {
  switch (status) {
    case 'pass': return 'NotAFinding';
    case 'fail': return 'Open';
    case 'error': return 'Not_Reviewed';
    default: return 'Not_Reviewed';
  }
}

/**
 * Generate a CKL (STIG Viewer Checklist) XML string from findings.
 *
 * CKL is the standard format used by DISA's STIG Viewer tool.
 * This generates a single CKL file for a specific host, containing
 * all VULN entries from the findings.
 */
export function generateCKL(
  findings: MultiHostFinding[],
  hostname: string,
  profileName: string,
): string {
  const vulnEntries = findings.map(finding => {
    // Find this host's result for this finding
    const hostResult = finding.hosts.find(h => h.host === hostname);
    const status = hostResult ? toCklStatus(hostResult.status) : 'Not_Reviewed';
    const details = hostResult
      ? `Actual: ${escapeXml(hostResult.actualValue)}\nExpected: ${escapeXml(hostResult.expectedValue)}`
      : '';

    return `      <VULN>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Vuln_Num</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${escapeXml(finding.stigId || finding.ruleId)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Rule_ID</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${escapeXml(finding.ruleId)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Rule_Title</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${escapeXml(finding.title)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Severity</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${toCklSeverity(finding.severity)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Fix_Text</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${escapeXml(finding.fixText)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STIG_DATA>
          <VULN_ATTRIBUTE>Check_Content</VULN_ATTRIBUTE>
          <ATTRIBUTE_DATA>${escapeXml(finding.checkText)}</ATTRIBUTE_DATA>
        </STIG_DATA>
        <STATUS>${status}</STATUS>
        <FINDING_DETAILS>${details}</FINDING_DETAILS>
        <COMMENTS></COMMENTS>
        <SEVERITY_OVERRIDE></SEVERITY_OVERRIDE>
        <SEVERITY_JUSTIFICATION></SEVERITY_JUSTIFICATION>
      </VULN>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<CHECKLIST>
  <ASSET>
    <ROLE>None</ROLE>
    <ASSET_TYPE>Computing</ASSET_TYPE>
    <HOST_NAME>${escapeXml(hostname)}</HOST_NAME>
    <HOST_IP></HOST_IP>
    <HOST_MAC></HOST_MAC>
    <HOST_FQDN></HOST_FQDN>
    <TARGET_COMMENT></TARGET_COMMENT>
    <TECH_AREA></TECH_AREA>
    <TARGET_KEY></TARGET_KEY>
    <WEB_OR_DATABASE>false</WEB_OR_DATABASE>
    <WEB_DB_SITE></WEB_DB_SITE>
    <WEB_DB_INSTANCE></WEB_DB_INSTANCE>
  </ASSET>
  <STIGS>
    <iSTIG>
      <STIG_INFO>
        <SI_DATA>
          <SID_NAME>title</SID_NAME>
          <SID_DATA>${escapeXml(profileName || 'Compliance Scan')}</SID_DATA>
        </SI_DATA>
        <SI_DATA>
          <SID_NAME>version</SID_NAME>
          <SID_DATA></SID_DATA>
        </SI_DATA>
      </STIG_INFO>
${vulnEntries.join('\n')}
    </iSTIG>
  </STIGS>
</CHECKLIST>`;
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export const ExportButton = ({ findings, profileName }: ExportButtonProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleExportCSV = () => {
    const csv = buildCSV(findings);
    const safeName = (profileName || 'scan').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `compliance-findings-${safeName}-${getDateStamp()}.csv`;
    downloadBlob(csv, filename, 'text/csv;charset=utf-8');
    handleClose();
  };

  const handleExportJSON = () => {
    const json = JSON.stringify(findings, null, 2);
    const safeName = (profileName || 'scan').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `compliance-findings-${safeName}-${getDateStamp()}.json`;
    downloadBlob(json, filename, 'application/json');
    handleClose();
  };

  const handleExportCKL = () => {
    // Use the first host found across all findings as the CKL target
    const allHosts = new Set<string>();
    for (const finding of findings) {
      for (const host of finding.hosts) {
        allHosts.add(host.host);
      }
    }
    const hostname = allHosts.values().next().value || 'unknown-host';
    const ckl = generateCKL(findings, hostname, profileName || 'Compliance Scan');
    const safeName = (profileName || 'scan').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `compliance-findings-${safeName}-${getDateStamp()}.ckl`;
    downloadBlob(ckl, filename, 'application/xml');
    handleClose();
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<GetAppIcon />}
        onClick={handleClick}
        disabled={findings.length === 0}
      >
        Export
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        <MenuItem onClick={handleExportCSV}>
          <ListItemIcon>
            <DescriptionIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Export as CSV"
            secondary="For auditors and spreadsheets"
          />
        </MenuItem>
        <MenuItem onClick={handleExportJSON}>
          <ListItemIcon>
            <CodeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Export as JSON"
            secondary="For integration with other tools"
          />
        </MenuItem>
        <MenuItem onClick={handleExportCKL}>
          <ListItemIcon>
            <AssignmentTurnedInIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Export as CKL"
            secondary="STIG Viewer checklist for DoD auditors"
          />
        </MenuItem>
      </Menu>
    </>
  );
};

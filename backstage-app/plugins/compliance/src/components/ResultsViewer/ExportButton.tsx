/**
 * Export button for compliance findings.
 *
 * Supports CSV and JSON export formats. Uses browser-native download
 * (Blob + anchor click) -- no server-side export needed.
 *
 * TODO: Add CKL (STIG Viewer) export format. CKL is an XML format with
 * a specific schema used by DISA's STIG Viewer tool. The schema requires
 * a CHECKLIST root element with ASSET and STIGS children, where each
 * finding maps to a VULN element with STATUS, FINDING_DETAILS, etc.
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
      </Menu>
    </>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InfoCard,
  Breadcrumbs,
  Progress,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import {
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  TextField,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  makeStyles,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import DeleteIcon from '@material-ui/icons/Delete';
import EditIcon from '@material-ui/icons/Edit';
import SettingsIcon from '@material-ui/icons/Settings';
import { complianceApiRef } from '../../api';

import type {
  ComplianceCartridge,
  SaveCartridgeRequest,
  CertificationStatus,
  ScanCertification,
} from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  formField: {
    marginBottom: theme.spacing(2),
  },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(6),
  },
  frameworkChip: {
    fontWeight: 600,
  },
  dialogContent: {
    minWidth: 500,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    paddingTop: theme.spacing(1),
  },
}));

const FRAMEWORK_OPTIONS = [
  { value: 'DISA_STIG', label: 'DISA STIG' },
  { value: 'CIS', label: 'CIS Benchmark' },
  { value: 'PCI_DSS', label: 'PCI-DSS' },
  { value: 'HIPAA', label: 'HIPAA' },
  { value: 'NIST_800_53', label: 'NIST 800-53' },
];

interface WorkflowTemplate {
  id: number;
  name: string;
  description: string;
}

interface ExecutionEnvironment {
  id: number;
  name: string;
  image: string;
}

const EMPTY_FORM: SaveCartridgeRequest = {
  displayName: '',
  description: '',
  framework: 'DISA_STIG',
  version: '',
  platform: '',
  platformSpec: null,
  workflowTemplateId: null,
  eeId: null,
  remediationPlaybookPath: '',
  scanTags: '',
};

const DataRetentionSettings = () => {
  const api = useApi(complianceApiRef);
  const [retentionDays, setRetentionDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  useEffect(() => {
    api.getHealth().then(h => {
      if (h.retentionDays) {
        setRetentionDays(h.retentionDays);
      }
    }).catch(() => {});
  }, [api]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateSettings({ retentionDays });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // Best effort
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanupResult(null);
    try {
      const data = await api.runCleanup();
      setCleanupResult(`Cleaned up ${data.deleted ?? 0} old findings`);
    } catch {
      setCleanupResult('Cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="textSecondary" paragraph>
        Configure how long scan findings are retained. Older findings are automatically
        cleaned up on startup. Scan records are preserved for history.
      </Typography>
      <Box display="flex" alignItems="center" style={{ gap: 16 }}>
        <TextField
          label="Retention Period (days)"
          type="number"
          variant="outlined"
          size="small"
          value={retentionDays}
          onChange={e => setRetentionDays(Number(e.target.value))}
          inputProps={{ min: 7, max: 365 }}
          style={{ width: 200 }}
        />
        <Button variant="outlined" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </Button>
        <Button variant="outlined" color="secondary" onClick={handleCleanup} disabled={cleaning}>
          {cleaning ? 'Cleaning...' : 'Run Cleanup Now'}
        </Button>
      </Box>
      {cleanupResult && (
        <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
          {cleanupResult}
        </Typography>
      )}
    </Box>
  );
};

export const CartridgeSettings = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);

  // Admin permission gate: reuse catalogEntityCreatePermission following
  // the upstream Ansible Portal pattern. The entire settings page is
  // restricted to users with admin/create permissions. When RBAC is not
  // configured, this defaults to allowed.
  const { allowed: isAdmin, loading: permissionLoading } = usePermission({
    permission: catalogEntityCreatePermission,
  });

  const [cartridges, setCartridges] = useState<ComplianceCartridge[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ComplianceCartridge | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form, setForm] = useState<SaveCartridgeRequest>({ ...EMPTY_FORM });

  // Controller resources for dropdowns
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [executionEnvironments, setExecutionEnvironments] = useState<ExecutionEnvironment[]>([]);

  // Certification form state
  const [certStatus, setCertStatus] = useState('uncertified');
  const [certAuthority, setCertAuthority] = useState('');

  const loadCartridges = useCallback(async () => {
    try {
      const data = await api.getCartridges();
      setCartridges(data);
    } catch (err) {
      console.error('Failed to load cartridges:', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadControllerResources = useCallback(async () => {
    try {
      const [wfts, jts, ees] = await Promise.all([
        api.getControllerWorkflowTemplates(),
        api.getControllerJobTemplates(),
        api.getControllerExecutionEnvironments(),
      ]);
      setWorkflowTemplates([...jts, ...wfts]);
      setExecutionEnvironments(ees);
    } catch (err) {
      console.error('Failed to load controller resources:', err);
    }
  }, [api]);

  // Track whether WJT selection was user-initiated (not initial edit load)
  const [autoPopulateEnabled, setAutoPopulateEnabled] = useState(false);

  // Auto-populate profile fields from the selected workflow job template's extra_vars
  useEffect(() => {
    if (!autoPopulateEnabled || !form.workflowTemplateId) return;
    let cancelled = false;

    // The WJT contains child nodes; look up the first JT node to get its extra_vars.
    // For simplicity, we use the WJT id to search for associated JTs.
    api.getJobTemplateDetail(form.workflowTemplateId).then(detail => {
      if (cancelled) return;
      try {
        const vars = JSON.parse(detail.extra_vars || '{}');
        if (vars.profile_name) {
          setForm(prev => ({ ...prev, displayName: prev.displayName || vars.profile_name }));
        }
        if (vars.framework) {
          setForm(prev => ({ ...prev, framework: vars.framework }));
        }
        if (vars.certification_status && ['certified', 'conformant', 'uncertified'].includes(vars.certification_status)) {
          setCertStatus(vars.certification_status);
        }
        if (vars.certification_authority) {
          setCertAuthority(vars.certification_authority);
        }
      } catch {
        // extra_vars not valid JSON — skip auto-populate
      }
    }).catch(() => {
      // JT detail fetch failed — non-fatal
    });

    return () => { cancelled = true; };
  }, [api, form.workflowTemplateId, autoPopulateEnabled]);

  useEffect(() => {
    loadCartridges();
  }, [loadCartridges]);

  const handleOpenDialog = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setCertStatus('uncertified');
    setCertAuthority('');
    setAutoPopulateEnabled(true);
    setSaveError(null);
    loadControllerResources();
    setDialogOpen(true);
  };

  const handleEditClick = async (cartridge: ComplianceCartridge) => {
    const fresh = await api.getCartridge(cartridge.id);
    if (!fresh) {
      await loadCartridges();
      setSaveError('This profile was deleted by another user.');
      return;
    }
    // Disable auto-populate during initial form population
    setAutoPopulateEnabled(false);
    setEditingId(fresh.id);
    setForm({
      displayName: fresh.displayName,
      description: fresh.description,
      framework: fresh.framework,
      version: fresh.version,
      platform: fresh.platform,
      platformSpec: fresh.platformSpec ?? null,
      workflowTemplateId: fresh.workflowTemplateId,
      eeId: fresh.eeId,
      remediationPlaybookPath: fresh.remediationPlaybookPath,
      scanTags: fresh.scanTags,
    });
    setCertStatus(fresh.certification?.status || 'uncertified');
    setCertAuthority(fresh.certification?.authority || '');
    // Re-enable auto-populate for subsequent WJT changes
    setTimeout(() => setAutoPopulateEnabled(true), 100);
    setSaveError(null);
    loadControllerResources();
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const certification = certStatus !== 'uncertified'
        ? { status: certStatus as CertificationStatus, authority: certAuthority, validationId: '', disclaimer: '' }
        : null;
      const payload = editingId
        ? { ...form, id: editingId, certification }
        : { ...form, certification };
      await api.saveCartridge(payload);
      handleCloseDialog();
      await loadCartridges();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await api.deleteCartridge(deleteTarget.id);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      await loadCartridges();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const handleDeleteClick = (cartridge: ComplianceCartridge) => {
    setDeleteTarget(cartridge);
    setDeleteError(null);
    setDeleteDialogOpen(true);
  };

  const updateForm = (field: keyof SaveCartridgeRequest, value: unknown) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const getFrameworkLabel = (value: string) => {
    return FRAMEWORK_OPTIONS.find(f => f.value === value)?.label ?? value;
  };

  const getWorkflowTemplateName = (id: number | null) => {
    if (id === null) return '--';
    return workflowTemplates.find(t => t.id === id)?.name ?? `ID ${id}`;
  };

  const getEeName = (id: number | null) => {
    if (id === null) return '--';
    return executionEnvironments.find(e => e.id === id)?.name ?? `ID ${id}`;
  };

  if (permissionLoading || loading) {
    return <Progress />;
  }

  if (!isAdmin) {
    return (
      <>
        <Breadcrumbs>
          <Typography
            color="primary"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/compliance')}
          >
            Compliance
          </Typography>
          <Typography>Settings</Typography>
        </Breadcrumbs>
        <Box mt={3} />
        <InfoCard title="Access Denied">
          <Typography variant="body1">
            You do not have permission to manage compliance profiles.
            Contact your administrator if you need access.
          </Typography>
        </InfoCard>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs>
        <Typography
          color="primary"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/compliance')}
        >
          Compliance
        </Typography>
        <Typography>Settings</Typography>
      </Breadcrumbs>

      <Box mt={3} />

      <InfoCard title="Compliance Profiles">
        <div className={classes.headerRow}>
          <Typography variant="body2" color="textSecondary">
            Each profile maps a compliance standard (e.g., DISA STIG, CIS) to an automation controller workflow job template and execution environment.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleOpenDialog}
          >
            Add Profile
          </Button>
        </div>

        {cartridges.length === 0 ? (
          <div className={classes.emptyState}>
            <SettingsIcon style={{ fontSize: 64, color: '#6A6E73', marginBottom: 16 }} />
            <Typography variant="h6" color="textSecondary" gutterBottom>
              No compliance profiles configured
            </Typography>
            <Typography variant="body2" color="textSecondary" paragraph>
              A compliance profile maps a standard (e.g., DISA STIG for RHEL 9) to
              a workflow job template and execution environment so you can scan
              and remediate from the portal.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleOpenDialog}
            >
              Add Compliance Profile
            </Button>
          </div>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Framework</TableCell>
                  <TableCell>Certification</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Platform</TableCell>
                  <TableCell>Scan Job Template</TableCell>
                  <TableCell>Execution Environment</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cartridges.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Typography variant="body2" style={{ fontWeight: 500 }}>
                        {c.displayName}
                      </Typography>
                      {c.description && (
                        <Typography variant="caption" color="textSecondary">
                          {c.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getFrameworkLabel(c.framework)}
                        size="small"
                        variant="outlined"
                        className={classes.frameworkChip}
                      />
                    </TableCell>
                    <TableCell>
                      {c.certification ? (
                        <Chip
                          label={c.certification.status === 'certified' ? 'Certified' : c.certification.status === 'conformant' ? 'Conformant' : 'Uncertified'}
                          size="small"
                          style={{
                            fontWeight: 600,
                            backgroundColor: c.certification.status === 'certified' ? '#3E8635' : c.certification.status === 'conformant' ? '#0066CC' : '#6A6E73',
                            color: '#fff',
                          }}
                        />
                      ) : (
                        <Chip label="Uncertified" size="small" style={{ fontWeight: 600, backgroundColor: '#6A6E73', color: '#fff' }} />
                      )}
                    </TableCell>
                    <TableCell>{c.version || '--'}</TableCell>
                    <TableCell>{c.platform || '--'}</TableCell>
                    <TableCell>{getWorkflowTemplateName(c.workflowTemplateId)}</TableCell>
                    <TableCell>{getEeName(c.eeId)}</TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => handleEditClick(c)}
                        aria-label="edit compliance profile"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteClick(c)}
                        aria-label="delete compliance profile"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </InfoCard>

      {/* ── Add Compliance Profile Dialog ──────────────────────────────── */}

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editingId ? 'Edit Compliance Profile' : 'Add Compliance Profile'}</DialogTitle>
        <DialogContent>
          <div className={classes.dialogContent}>
            <TextField
              label="Profile Name"
              variant="outlined"
              fullWidth
              required
              value={form.displayName}
              onChange={e => updateForm('displayName', e.target.value)}
              helperText="A descriptive name for this profile, e.g. 'DISA STIG for RHEL 9'"
              className={classes.formField}
            />

            <TextField
              label="Description"
              variant="outlined"
              fullWidth
              multiline
              rows={2}
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              helperText="Optional context shown alongside the profile name in scan and results views"
              className={classes.formField}
            />

            <FormControl variant="outlined" fullWidth className={classes.formField}>
              <InputLabel>Compliance Standard</InputLabel>
              <Select
                value={form.framework}
                onChange={e => updateForm('framework', e.target.value)}
                label="Compliance Standard"
              >
                {FRAMEWORK_OPTIONS.map(f => (
                  <MenuItem key={f.value} value={f.value}>
                    {f.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Standard Version"
              variant="outlined"
              fullWidth
              placeholder="e.g., V2R8"
              value={form.version}
              onChange={e => updateForm('version', e.target.value)}
              helperText="The release version of the standard (e.g., V2R8 for DISA STIG, v1.0 for CIS)"
              className={classes.formField}
            />

            <TextField
              label="Target Platform"
              variant="outlined"
              fullWidth
              placeholder="e.g., RHEL 9"
              value={form.platform}
              onChange={e => updateForm('platform', e.target.value)}
              helperText="The operating system or platform this profile applies to"
              className={classes.formField}
            />

            <Typography variant="subtitle2" style={{ marginTop: 16, marginBottom: 8 }}>
              Platform Requirements
            </Typography>

            <TextField
              label="OS Family"
              variant="outlined"
              fullWidth
              value={form.platformSpec?.os_family?.join(', ') || ''}
              onChange={e => {
                const val = e.target.value;
                setForm(prev => ({
                  ...prev,
                  platformSpec: {
                    ...prev.platformSpec,
                    os_family: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined,
                  },
                }));
              }}
              helperText="Comma-separated: RedHat, Windows, etc."
              className={classes.formField}
            />

            <TextField
              label="OS Version"
              variant="outlined"
              fullWidth
              value={form.platformSpec?.os_version?.join(', ') || ''}
              onChange={e => {
                const val = e.target.value;
                setForm(prev => ({
                  ...prev,
                  platformSpec: {
                    ...prev.platformSpec,
                    os_version: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined,
                  },
                }));
              }}
              helperText="Comma-separated major versions: 9, 8, 2022, etc."
              className={classes.formField}
            />

            <TextField
              label="Device Type"
              variant="outlined"
              fullWidth
              value={form.platformSpec?.device_type?.join(', ') || ''}
              onChange={e => {
                const val = e.target.value;
                setForm(prev => ({
                  ...prev,
                  platformSpec: {
                    ...prev.platformSpec,
                    device_type: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined,
                  },
                }));
              }}
              helperText="For network profiles: cisco_ios, cisco_nxos, etc."
              className={classes.formField}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={form.platformSpec?.scanner_validates || false}
                  onChange={e => {
                    setForm(prev => ({
                      ...prev,
                      platformSpec: {
                        ...prev.platformSpec,
                        scanner_validates: e.target.checked || undefined,
                      },
                    }));
                  }}
                />
              }
              label="External scanner handles platform validation"
            />

            <FormControl variant="outlined" fullWidth className={classes.formField}>
              <InputLabel>Scan Job Template</InputLabel>
              <Select
                value={form.workflowTemplateId ?? ''}
                onChange={e => {
                  const val = e.target.value;
                  updateForm('workflowTemplateId', val === '' ? null : Number(val));
                }}
                label="Scan Job Template"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {workflowTemplates.map(t => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="textSecondary" style={{ marginTop: 4, marginLeft: 14 }}>
                Select a scan JT to auto-populate profile fields from its default extra_vars
              </Typography>
            </FormControl>

            <FormControl variant="outlined" fullWidth className={classes.formField}>
              <InputLabel>Execution Environment</InputLabel>
              <Select
                value={form.eeId ?? ''}
                onChange={e => {
                  const val = e.target.value;
                  updateForm('eeId', val === '' ? null : Number(val));
                }}
                label="Execution Environment"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {executionEnvironments.map(ee => (
                  <MenuItem key={ee.id} value={ee.id}>
                    {ee.name}
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="textSecondary" style={{ marginTop: 4, marginLeft: 14 }}>
                The EE that contains the scanner tooling and compliance content (e.g., scap-security-guide)
              </Typography>
            </FormControl>

            <TextField
              label="Remediation Playbook Path"
              variant="outlined"
              fullWidth
              placeholder="/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml"
              value={form.remediationPlaybookPath}
              onChange={e => updateForm('remediationPlaybookPath', e.target.value)}
              helperText="Filesystem path inside the EE to the remediation playbook. Installed by scap-security-guide at /usr/share/scap-security-guide/ansible/"
              className={classes.formField}
            />

            <TextField
              label="Scan Tags"
              variant="outlined"
              fullWidth
              placeholder="e.g., sshd_set_idle_timeout, accounts_tmout"
              value={form.scanTags}
              onChange={e => updateForm('scanTags', e.target.value)}
              helperText="Optional. Comma-separated rule IDs to limit which rules are included. Leave empty to scan all rules in the standard."
              className={classes.formField}
            />

            <TextField
              select
              label="Certification Status"
              value={certStatus}
              onChange={e => setCertStatus(e.target.value)}
              fullWidth
              margin="normal"
              size="small"
            >
              <MenuItem value="uncertified">Uncertified</MenuItem>
              <MenuItem value="conformant">Conformant</MenuItem>
              <MenuItem value="certified">Certified</MenuItem>
            </TextField>
            {certStatus !== 'uncertified' && (
              <TextField
                label="Certification Authority"
                value={certAuthority}
                onChange={e => setCertAuthority(e.target.value)}
                fullWidth
                margin="normal"
                size="small"
                helperText="e.g. NIST SCAP 1.2, CIS"
              />
            )}
          </div>
          {saveError && (
            <Typography color="error" variant="body2" style={{ marginTop: 8 }}>
              {saveError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSave}
            disabled={saving || !form.displayName || !form.framework}
          >
            {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Data Retention ─────────────────────────────────────────── */}
      <Box mt={4} />
      <InfoCard title="Data Management">
        <DataRetentionSettings />
      </InfoCard>

      {/* ── Delete Confirmation Dialog ───────────────────────────────── */}

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Compliance Profile</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the compliance profile{' '}
            <strong>{deleteTarget?.displayName}</strong>? This will not affect
            existing scan results or platform resources.
          </Typography>
          {deleteError && (
            <Typography color="error" variant="body2" style={{ marginTop: 8 }}>
              {deleteError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleDeleteConfirm}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

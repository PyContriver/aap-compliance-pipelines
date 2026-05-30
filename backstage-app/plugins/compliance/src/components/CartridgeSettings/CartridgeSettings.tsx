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
  TextField,
  makeStyles,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import DeleteIcon from '@material-ui/icons/Delete';
import EditIcon from '@material-ui/icons/Edit';
import SettingsIcon from '@material-ui/icons/Settings';
import { complianceApiRef } from '../../api';
import { CertificationBadge } from '../shared/CertificationBadge';
import { ProfileFormDialog } from './ProfileFormDialog';

import type {
  ComplianceCartridge,
  SaveCartridgeRequest,
} from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(6),
  },
  frameworkChip: {
    fontWeight: 600,
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

  const { allowed: isAdmin, loading: permissionLoading } = usePermission({
    permission: catalogEntityCreatePermission,
  });

  const [cartridges, setCartridges] = useState<ComplianceCartridge[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCartridge, setEditCartridge] = useState<ComplianceCartridge | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ComplianceCartridge | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [executionEnvironments, setExecutionEnvironments] = useState<ExecutionEnvironment[]>([]);

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

  useEffect(() => {
    loadCartridges();
  }, [loadCartridges]);

  const handleOpenDialog = () => {
    setEditCartridge(null);
    loadControllerResources();
    setDialogOpen(true);
  };

  const handleEditClick = async (cartridge: ComplianceCartridge) => {
    const fresh = await api.getCartridge(cartridge.id);
    if (!fresh) {
      await loadCartridges();
      return;
    }
    setEditCartridge(fresh);
    loadControllerResources();
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditCartridge(null);
  };

  const handleSave = async (request: SaveCartridgeRequest) => {
    await api.saveCartridge(request);
    handleCloseDialog();
    await loadCartridges();
  };

  const handleDeleteClick = (cartridge: ComplianceCartridge) => {
    setDeleteTarget(cartridge);
    setDeleteError(null);
    setDeleteDialogOpen(true);
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

  const getFrameworkLabel = (value: string) => {
    return FRAMEWORK_OPTIONS.find(f => f.value === value)?.label ?? value;
  };

  if (permissionLoading || loading) {
    return <Progress />;
  }

  if (!isAdmin) {
    return (
      <>
        <Breadcrumbs>
          <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
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
        <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
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
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenDialog}>
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
            <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenDialog}>
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
                      <Chip label={getFrameworkLabel(c.framework)} size="small" variant="outlined" className={classes.frameworkChip} />
                    </TableCell>
                    <TableCell>
                      <CertificationBadge certification={c.certification} />
                    </TableCell>
                    <TableCell>{c.version || '--'}</TableCell>
                    <TableCell>{c.platform || '--'}</TableCell>
                    <TableCell>{c.workflowTemplateId ? `ID ${c.workflowTemplateId}` : '--'}</TableCell>
                    <TableCell>{c.eeId ? `ID ${c.eeId}` : '--'}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => handleEditClick(c)} aria-label="edit compliance profile">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDeleteClick(c)} aria-label="delete compliance profile">
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

      <ProfileFormDialog
        open={dialogOpen}
        editCartridge={editCartridge}
        workflowTemplates={workflowTemplates}
        executionEnvironments={executionEnvironments}
        onClose={handleCloseDialog}
        onSave={handleSave}
      />

      <Box mt={4} />
      <InfoCard title="Data Management">
        <DataRetentionSettings />
      </InfoCard>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
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
          <Button variant="contained" color="secondary" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

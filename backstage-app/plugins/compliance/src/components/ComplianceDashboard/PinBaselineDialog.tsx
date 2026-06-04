import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  CircularProgress,
  makeStyles,
} from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import { complianceApiRef } from '../../api';
import type { RemediationProfile, BaselineTarget } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  helperText: {
    color: theme.palette.text.secondary,
    fontSize: '0.85rem',
    marginBottom: theme.spacing(2),
    lineHeight: 1.5,
  },
  currentBaseline: {
    padding: theme.spacing(1.5),
    backgroundColor: theme.palette.type === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    borderRadius: theme.shape.borderRadius,
    marginBottom: theme.spacing(2),
  },
  ruleCount: {
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
}));

interface PinBaselineDialogProps {
  open: boolean;
  onClose: () => void;
  complianceProfileId: string;
  complianceProfileName: string;
  inventoryId: number;
  inventoryName: string;
  existingBaseline?: BaselineTarget;
  onPinned: () => void;
}

export const PinBaselineDialog: React.FC<PinBaselineDialogProps> = ({
  open,
  onClose,
  complianceProfileId,
  complianceProfileName,
  inventoryId,
  inventoryName,
  existingBaseline,
  onPinned,
}) => {
  const classes = useStyles();
  const api = useApi(complianceApiRef);
  const [profiles, setProfiles] = useState<RemediationProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getRemediationProfiles?.('saved')
      .then(rps => {
        const matching = rps.filter(rp => rp.complianceProfileId === complianceProfileId);
        setProfiles(matching);
        if (existingBaseline) {
          setSelectedProfileId(existingBaseline.remediationProfileId);
        } else if (matching.length === 1) {
          setSelectedProfileId(matching[0].id);
        } else {
          setSelectedProfileId('');
        }
      })
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [open, api, complianceProfileId, existingBaseline]);

  const handlePin = async () => {
    if (!selectedProfileId) return;
    setSubmitting(true);
    try {
      if (existingBaseline) {
        await api.unpinBaselineTarget(existingBaseline.id);
      }
      await api.pinBaselineTarget({
        remediationProfileId: selectedProfileId,
        complianceProfileId,
        inventoryId,
      });
      onClose();
      onPinned();
    } catch (err) {
      console.error('Failed to pin baseline:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnpin = async () => {
    if (!existingBaseline) return;
    setSubmitting(true);
    try {
      await api.unpinBaselineTarget(existingBaseline.id);
      onClose();
      onPinned();
    } catch (err) {
      console.error('Failed to unpin baseline:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const enabledRules = selectedProfile?.selections?.filter(s => s.enabled).length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {existingBaseline ? 'Manage Baseline' : 'Pin a Baseline'}
      </DialogTitle>
      <DialogContent>
        <Typography className={classes.helperText}>
          A baseline is a curated set of rules you've chosen to enforce.
          Pinning it here lets you track progress toward your specific
          compliance target, separate from the full {complianceProfileName} standard.
        </Typography>

        <Typography variant="body2" style={{ marginBottom: 16 }}>
          <strong>Inventory:</strong> {inventoryName}
        </Typography>

        {existingBaseline && (
          <Box className={classes.currentBaseline}>
            <Typography variant="body2">
              <strong>Current baseline:</strong>{' '}
              {profiles.find(p => p.id === existingBaseline.remediationProfileId)?.name
                ?? existingBaseline.remediationProfileId}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              Pinned {new Date(existingBaseline.pinnedAt).toLocaleDateString()}
            </Typography>
          </Box>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={32} />
          </Box>
        ) : profiles.length === 0 ? (
          <Typography color="textSecondary" style={{ textAlign: 'center', padding: 16 }}>
            No saved remediation profiles found for {complianceProfileName}.
            Create one from the Remediations tab first.
          </Typography>
        ) : (
          <>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>Remediation profile</InputLabel>
              <Select
                value={selectedProfileId}
                onChange={e => setSelectedProfileId(e.target.value as string)}
                label="Remediation profile"
              >
                {profiles.map(rp => {
                  const count = rp.selections?.filter(s => s.enabled).length ?? 0;
                  return (
                    <MenuItem key={rp.id} value={rp.id}>
                      {rp.name} ({count} rules)
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            {selectedProfile && (
              <Typography className={classes.ruleCount} style={{ marginTop: 8 }}>
                This baseline covers {enabledRules} rules. The dashboard will show
                your compliance against these {enabledRules} rules alongside the
                full {complianceProfileName} score.
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {existingBaseline && (
          <Button onClick={handleUnpin} disabled={submitting} color="secondary">
            Unpin
          </Button>
        )}
        <Box flex={1} />
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handlePin}
          disabled={!selectedProfileId || submitting || profiles.length === 0}
          color="primary"
          variant="contained"
        >
          {submitting ? <CircularProgress size={20} /> : existingBaseline ? 'Replace' : 'Pin'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

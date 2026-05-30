import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Breadcrumbs,
  Progress,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import {
  Typography, Button, Chip, Box, Switch, Collapse, IconButton,
  TextField, FormControl, InputLabel, Select, MenuItem, Divider,
  Radio, RadioGroup, FormControlLabel, makeStyles, ButtonGroup,
} from '@material-ui/core';
import SettingsIcon from '@material-ui/icons/Settings';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import WarningIcon from '@material-ui/icons/Warning';
import InfoIcon from '@material-ui/icons/Info';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import type { FindingSeverity, MultiHostFinding, RemediationProfile } from '@aap-compliance/common';
import { complianceApiRef } from '../../api';

const useStyles = makeStyles(theme => ({
  findingCard: { border: `1px solid ${theme.palette.divider}`, borderRadius: theme.shape.borderRadius, marginBottom: theme.spacing(1), overflow: 'hidden' },
  findingHeader: { display: 'flex', alignItems: 'center', padding: theme.spacing(1.5, 2), gap: theme.spacing(1.5) },
  findingDisabled: { opacity: 0.5, backgroundColor: theme.palette.action.disabledBackground },
  findingEnabled: { backgroundColor: theme.palette.background.paper },
  severityChip: { fontWeight: 600, minWidth: 60 },
  catI: { backgroundColor: '#C9190B', color: '#fff' },
  catII: { backgroundColor: '#F0AB00', color: '#fff' },
  catIII: { backgroundColor: '#0066CC', color: '#fff' },
  detailPanel: { padding: theme.spacing(2, 3), backgroundColor: theme.palette.background.default, borderTop: `1px solid ${theme.palette.divider}` },
  summaryBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing(2), backgroundColor: theme.palette.background.default, borderRadius: theme.shape.borderRadius, marginBottom: theme.spacing(2), flexWrap: 'wrap' as const, gap: theme.spacing(1) },
  summaryCount: { display: 'flex', gap: theme.spacing(3), flexWrap: 'wrap' as const },
  bulkActions: { display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap' as const, alignItems: 'center' },
  disruptionWarning: { display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), color: theme.palette.warning.main, fontSize: '0.75rem' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing(1.5, 2), backgroundColor: theme.palette.action.hover, borderRadius: theme.shape.borderRadius, marginBottom: theme.spacing(1), marginTop: theme.spacing(2), cursor: 'pointer' },
  titleGroup: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 },
  hostBreakdown: { display: 'flex', alignItems: 'center', gap: theme.spacing(1), fontSize: '0.8rem', color: theme.palette.text.secondary },
  adviceBanner: { display: 'flex', alignItems: 'flex-start', gap: theme.spacing(1), padding: theme.spacing(1.5, 2), backgroundColor: '#FFF3CD', borderRadius: theme.shape.borderRadius, marginBottom: theme.spacing(1.5), border: '1px solid #FFECB5' },
  adviceIcon: { color: '#856404', marginTop: 2 },
  remediationStrategy: { padding: theme.spacing(1.5, 0) },
  profileHeader: { display: 'flex', alignItems: 'flex-start', gap: theme.spacing(2), padding: theme.spacing(2), backgroundColor: theme.palette.background.default, borderRadius: theme.shape.borderRadius, marginBottom: theme.spacing(2), border: `1px solid ${theme.palette.divider}` },
  autoSaveIndicator: { display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), fontSize: '0.75rem', color: theme.palette.text.secondary, minWidth: 80, flexShrink: 0 },
  savedIcon: { fontSize: 14, color: '#3E8635' },
  viewToggle: { marginRight: theme.spacing(2) },
  viewToggleActive: { fontWeight: 600 },
  passingNote: { display: 'flex', alignItems: 'center', gap: theme.spacing(1), padding: theme.spacing(1, 2), marginBottom: theme.spacing(1), color: theme.palette.text.secondary, fontSize: '0.85rem' },
  passingNoteIcon: { color: '#3E8635', fontSize: 18 },
}));

type ViewMode = 'status' | 'category';
type RemediationScope = 'failed_only' | 'standardize_all';
interface RuleSelection { enabled: boolean; expanded: boolean; scope: RemediationScope; parameters: Record<string, string | number | boolean>; }
type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const severityLabel: Record<FindingSeverity, string> = { CAT_I: 'CAT I — Critical', CAT_II: 'CAT II — Medium', CAT_III: 'CAT III — Low' };

export const RemediationProfileBuilder = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const { jobId, remediationId } = useParams<{ jobId?: string; remediationId?: string }>();
  const [searchParams] = useSearchParams();
  const isEditMode = !!remediationId;
  const isApplyMode = isEditMode && searchParams.get('apply') === 'true';
  const [editProfile, setEditProfile] = useState<RemediationProfile | null>(null);
  const { allowed: canRemediate } = usePermission({ permission: catalogEntityCreatePermission });

  const [profileName, setProfileName] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [launching, setLaunching] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedProfileId, setSavedProfileId] = useState<string | undefined>(undefined);
  const [allFindings, setAllFindings] = useState<MultiHostFinding[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('status');
  const [severityFilter, setSeverityFilter] = useState<'all' | FindingSeverity>('all');
  const [passingRulesExpanded, setPassingRulesExpanded] = useState(false);

  useEffect(() => {
    if (!isEditMode || !remediationId) return;
    let cancelled = false;
    api.getRemediationProfile(remediationId)
      .then(profile => {
        if (cancelled || !profile) { if (!cancelled) setLoading(false); return undefined; }
        setEditProfile(profile); setProfileName(profile.name); setProfileDescription(profile.description); setSavedProfileId(profile.id);
        const scanIdToUse = profile.scanId && /^\d+$/.test(profile.scanId) ? profile.scanId : undefined;
        return scanIdToUse ? api.getFindings(scanIdToUse) : api.getFindings();
      })
      .then(data => { if (!cancelled && data) setAllFindings(data); })
      .catch(err => { console.error('Failed to load remediation profile for editing:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, isEditMode, remediationId]);

  const [resolvedProfileId, setResolvedProfileId] = useState<string>('');

  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    Promise.all([
      api.getFindings(jobId),
      api.getRegisteredProfiles().catch(() => []),
      api.getScans().catch(() => []),
    ]).then(([data, profiles, scans]) => {
      if (cancelled) return;
      setAllFindings(data);
      if (profiles.length > 0) {
        const scan = scans.find(s => s.id === jobId || String(s.workflowJobId) === jobId);
        const matchedProfile = scan ? profiles.find(p => p.id === scan.profileId) : undefined;
        setResolvedProfileId(matchedProfile?.id ?? profiles[0].id);
      }
    }).catch(err => {
      console.error('Failed to load findings:', err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, jobId, isEditMode]);

  const [selections, setSelections] = useState<Record<string, RuleSelection>>({});

  useEffect(() => {
    if (allFindings.length === 0) return;
    setSelections(prev => {
      if (Object.keys(prev).length > 0) return prev;
      const savedSelections = editProfile?.selections ?? [];
      const savedMap = new Map(savedSelections.map(s => [s.ruleId, s]));
      const initial: Record<string, RuleSelection> = {};
      allFindings.forEach(f => {
        const saved = savedMap.get(f.ruleId);
        const isFailed = f.failCount > 0;
        initial[f.ruleId] = {
          enabled: saved ? saved.enabled : (isFailed ? (isEditMode ? false : f.disruption !== 'high') : false),
          expanded: false,
          scope: (saved?.scope as RemediationScope) ?? 'failed_only',
          parameters: saved?.parameters ? { ...Object.fromEntries(f.parameters.map(p => [p.name, p.default])), ...saved.parameters } : Object.fromEntries(f.parameters.map(p => [p.name, p.default])),
        };
      });
      return initial;
    });
  }, [allFindings, editProfile, isEditMode]);

  const toggleFinding = (ruleId: string) => { setSelections(prev => ({ ...prev, [ruleId]: { ...prev[ruleId], enabled: !prev[ruleId].enabled } })); };
  const toggleExpanded = (ruleId: string) => { setSelections(prev => ({ ...prev, [ruleId]: { ...prev[ruleId], expanded: !prev[ruleId].expanded } })); };
  const setScope = (ruleId: string, scope: RemediationScope) => { setSelections(prev => ({ ...prev, [ruleId]: { ...prev[ruleId], scope } })); };
  const updateParameter = (ruleId: string, paramName: string, value: string | number | boolean) => { setSelections(prev => ({ ...prev, [ruleId]: { ...prev[ruleId], parameters: { ...prev[ruleId].parameters, [paramName]: value } } })); };
  // Filtered findings based on search query
  const filteredFindings = useMemo(() => {
    if (!searchQuery) return allFindings;
    const q = searchQuery.toLowerCase();
    return allFindings.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.ruleId.toLowerCase().includes(q) ||
      f.stigId?.toLowerCase().includes(q) ||
      f.description?.toLowerCase().includes(q) ||
      f.category?.toLowerCase().includes(q),
    );
  }, [allFindings, searchQuery]);

  const displayFindings = useMemo(() => {
    let result = searchQuery ? filteredFindings : allFindings;
    if (severityFilter !== 'all') {
      result = result.filter(f => f.severity === severityFilter);
    }
    return result;
  }, [filteredFindings, allFindings, searchQuery, severityFilter]);
  const failedFindings = useMemo(() => displayFindings.filter(f => f.failCount > 0), [displayFindings]);
  const passingFindings = useMemo(() => displayFindings.filter(f => f.failCount === 0), [displayFindings]);

  const selectAllFailed = () => { setSelections(prev => { const updated = { ...prev }; allFindings.forEach(f => { if (f.failCount > 0) { updated[f.ruleId] = { ...updated[f.ruleId], enabled: true }; } }); return updated; }); };
  const clearAll = () => { setSelections(prev => { const updated = { ...prev }; Object.keys(updated).forEach(k => { updated[k] = { ...updated[k], enabled: false }; }); return updated; }); };
  const selectDisplayed = () => { setSelections(prev => { const updated = { ...prev }; displayFindings.forEach(f => { updated[f.ruleId] = { ...updated[f.ruleId], enabled: true }; }); return updated; }); };
  const deselectDisplayed = () => { setSelections(prev => { const updated = { ...prev }; displayFindings.forEach(f => { updated[f.ruleId] = { ...updated[f.ruleId], enabled: false }; }); return updated; }); };

  const enabledCount = Object.values(selections).filter(s => s.enabled).length;
  const disabledCount = Object.values(selections).filter(s => !s.enabled).length;
  const totalAffectedHosts = useMemo(() => { const hostSet = new Set<string>(); allFindings.forEach(f => { const sel = selections[f.ruleId]; if (sel?.enabled) { const failedHosts = f.hosts.filter(h => h.status === 'fail'); if (sel.scope === 'standardize_all' || failedHosts.length === 0) { f.hosts.forEach(h => hostSet.add(h.host)); } else { failedHosts.forEach(h => hostSet.add(h.host)); } } }); return hostSet.size; }, [allFindings, selections]);
  const groupedBySeverity = useMemo(() => { const groups: Record<FindingSeverity, MultiHostFinding[]> = { CAT_I: [], CAT_II: [], CAT_III: [] }; displayFindings.forEach(f => groups[f.severity].push(f)); return groups; }, [displayFindings]);
  const getSeverityClass = (severity: FindingSeverity) => { switch (severity) { case 'CAT_I': return classes.catI; case 'CAT_II': return classes.catII; case 'CAT_III': return classes.catIII; default: return ''; } };

  // Auto-save (Insights pattern)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionsRef = useRef(selections); selectionsRef.current = selections;
  const profileNameRef = useRef(profileName); profileNameRef.current = profileName;
  const profileDescriptionRef = useRef(profileDescription); profileDescriptionRef.current = profileDescription;
  const savedProfileIdRef = useRef(savedProfileId); savedProfileIdRef.current = savedProfileId;

  const performAutoSave = useCallback(async () => {
    const name = profileNameRef.current;
    if (!name) return;
    setAutoSaveStatus('saving'); setSaveError(null);
    try {
      const allSelections = allFindings.map(f => ({ ruleId: f.ruleId, enabled: selectionsRef.current[f.ruleId]?.enabled ?? false, parameters: selectionsRef.current[f.ruleId]?.parameters ?? {}, scope: selectionsRef.current[f.ruleId]?.scope }));
      const effectiveScanId = isEditMode ? (editProfile?.scanId || editProfile?.complianceProfileId || '') : (jobId ?? '');
      const saved = await api.saveRemediationProfile({ id: savedProfileIdRef.current ?? (isEditMode ? editProfile?.id : undefined), name, description: profileDescriptionRef.current, complianceProfileId: editProfile?.complianceProfileId || resolvedProfileId, scanId: effectiveScanId, selections: allSelections });
      if (!savedProfileIdRef.current) { setSavedProfileId(saved.id); }
      setAutoSaveStatus('saved');
    } catch (err) { setAutoSaveStatus('error'); setSaveError(err instanceof Error ? err.message : 'Auto-save failed'); }
  }, [api, allFindings, editProfile, isEditMode, jobId]);

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (Object.keys(selections).length === 0 || !profileName) { hasInitializedRef.current = false; return; }
    if (!hasInitializedRef.current) { hasInitializedRef.current = true; return; }
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); }
    autoSaveTimerRef.current = setTimeout(() => { performAutoSave(); }, 2000);
    return () => { if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); } };
  }, [selections, profileName, profileDescription, performAutoSave]);

  const renderAutoSaveStatus = () => {
    if (autoSaveStatus === 'saving') return (<div className={classes.autoSaveIndicator} data-testid="auto-save-status"><Typography variant="caption" style={{ color: '#6A6E73' }}>Saving...</Typography></div>);
    if (autoSaveStatus === 'saved') return (<div className={classes.autoSaveIndicator} data-testid="auto-save-status"><CheckCircleIcon className={classes.savedIcon} /><Typography variant="caption" style={{ color: '#3E8635' }}>Saved</Typography></div>);
    if (autoSaveStatus === 'error') return (<div className={classes.autoSaveIndicator} data-testid="auto-save-status"><WarningIcon style={{ fontSize: 14, color: '#C9190B' }} /><Typography variant="caption" style={{ color: '#C9190B' }}>Save failed</Typography></div>);
    return null;
  };

  const renderFinding = (finding: MultiHostFinding) => {
    const sel = selections[finding.ruleId];
    if (!sel) return null;
    return (
      <div key={finding.ruleId} className={`${classes.findingCard} ${sel.enabled ? classes.findingEnabled : classes.findingDisabled}`}>
        <div className={classes.findingHeader}>
          <Switch checked={sel.enabled} onChange={() => toggleFinding(finding.ruleId)} color="primary" size="small" inputProps={{ 'aria-label': `Toggle rule ${finding.stigId} for remediation` }} />
          {finding.stigId && <Chip label={finding.stigId} size="small" variant="outlined" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />}
          <Chip label={finding.severity === 'CAT_I' ? 'CAT I' : finding.severity === 'CAT_II' ? 'CAT II' : 'CAT III'} size="small" className={`${classes.severityChip} ${getSeverityClass(finding.severity)}`} />
          <div className={classes.titleGroup}>
            <Typography variant="subtitle2">{finding.title}</Typography>
            <div className={classes.hostBreakdown}>
              {finding.failCount > 0 ? (
                <>
                  <span style={{ color: '#C9190B', fontWeight: 600 }}>{finding.failCount} failed</span><span>/</span><span>{finding.totalCount} hosts</span>
                  {finding.hosts.filter(h => h.status === 'fail').length > 0 && (<span style={{ color: '#666' }}>({finding.hosts.filter(h => h.status === 'fail').map(h => h.host).join(', ')})</span>)}
                </>
              ) : (
                <span style={{ color: '#3E8635', fontWeight: 600 }}>{finding.passCount}/{finding.totalCount} hosts passing</span>
              )}
            </div>
          </div>
          {finding.disruption === 'high' && (<div className={classes.disruptionWarning}><WarningIcon fontSize="small" /><span>High disruption</span></div>)}
          <IconButton size="small" onClick={e => { e.stopPropagation(); toggleExpanded(finding.ruleId); }} aria-label={sel.expanded ? `Collapse rule details for ${finding.stigId}` : `Expand rule details for ${finding.stigId}`}>{sel.expanded ? <ExpandLessIcon /> : <SettingsIcon fontSize="small" />}</IconButton>
        </div>
        <Collapse in={sel.expanded}>
          <div className={classes.detailPanel}>
            {finding.description && (<Box mb={2}><Typography variant="body2">{finding.description}</Typography></Box>)}
            {(finding.checkText || finding.fixText) && (<Box mb={2} display="flex" flexDirection="column" style={{ gap: 12 }}>{finding.checkText && (<div><Typography variant="caption" color="textSecondary" style={{ fontWeight: 600 }}>Check</Typography><Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: '0.8rem', marginTop: 2 }}>{finding.checkText}</Typography></div>)}{finding.fixText && (<div><Typography variant="caption" color="textSecondary" style={{ fontWeight: 600 }}>Fix</Typography><Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: '0.8rem', marginTop: 2 }}>{finding.fixText}</Typography></div>)}</Box>)}
            {finding.disruption && (<Box mb={2}><Chip size="small" label={`Disruption: ${finding.disruption}`} style={{ backgroundColor: finding.disruption === 'high' ? '#C9190B' : finding.disruption === 'medium' ? '#F0AB00' : '#3E8635', color: '#fff', fontWeight: 600 }} /></Box>)}
            {finding.passCount > 0 && finding.failCount > 0 && (<div className={classes.adviceBanner}><InfoIcon className={classes.adviceIcon} fontSize="small" /><div><Typography variant="body2" style={{ color: '#856404', fontWeight: 600 }}>Only {finding.failCount} of {finding.totalCount} hosts failed this rule.</Typography><Typography variant="caption" style={{ color: '#856404' }}>Consider whether {finding.hosts.filter(h => h.status === 'fail').map(h => h.host).join(', ')} should belong to a different inventory with different compliance requirements.</Typography></div></div>)}
            <div className={classes.remediationStrategy}>
              <Typography variant="caption" color="textSecondary" gutterBottom>Remediation Scope</Typography>
              {finding.failCount === 0 ? (
                <Typography variant="body2" color="textSecondary" style={{ marginTop: 4 }}>All {finding.totalCount} hosts are compliant {'—'} enabling this rule enforces continuous compliance.</Typography>
              ) : finding.failCount === finding.totalCount ? (<Typography variant="body2" color="textSecondary" style={{ marginTop: 4 }}>All {finding.totalCount} hosts failed {'—'} remediation will apply to all hosts.</Typography>) : (
                <RadioGroup value={sel.scope} onChange={e => setScope(finding.ruleId, e.target.value as RemediationScope)}>
                  <FormControlLabel value="failed_only" control={<Radio size="small" color="primary" />} label={<Typography variant="body2">Remediate failed hosts only ({finding.failCount} hosts)</Typography>} />
                  <FormControlLabel value="standardize_all" control={<Radio size="small" color="primary" />} label={<Typography variant="body2">Apply to all hosts {'—'} standardize to same setting ({finding.totalCount} hosts)</Typography>} />
                </RadioGroup>)}
            </div>
            {finding.parameters.length > 0 && (<Box mt={2}><Typography variant="caption" color="textSecondary" gutterBottom>Parameters{sel.scope === 'standardize_all' && (<span style={{ fontStyle: 'italic' }}> {'—'} applied to all {finding.totalCount} hosts</span>)}</Typography><Box display="flex" flexWrap="wrap" style={{ gap: 16, marginTop: 8 }}>{finding.parameters.map(param => (<div key={param.name} style={{ flex: '1 1 200px', maxWidth: 300 }}>{param.type === 'select' ? (<FormControl variant="outlined" size="small" fullWidth><InputLabel>{param.label}</InputLabel><Select value={sel.parameters[param.name] ?? param.default} onChange={e => updateParameter(finding.ruleId, param.name, e.target.value as string)} label={param.label}>{param.options?.map(opt => (<MenuItem key={String(opt.value)} value={opt.value}>{opt.label}</MenuItem>))}</Select></FormControl>) : (<TextField label={param.label} variant="outlined" size="small" fullWidth type={param.type === 'number' ? 'number' : 'text'} value={sel.parameters[param.name] ?? param.default} onChange={e => updateParameter(finding.ruleId, param.name, param.type === 'number' ? Number(e.target.value) : e.target.value)} helperText={param.description} />)}</div>))}</Box></Box>)}
            {finding.hosts.filter(h => h.status === 'fail').length > 0 && (
              <Box mt={2}><Typography variant="caption" color="textSecondary">Failed Hosts {'—'} Actual Values</Typography><Box mt={1}>{finding.hosts.filter(h => h.status === 'fail').map(h => (<Box key={h.host} display="flex" style={{ gap: 16 }} py={0.5}><Typography variant="body2" style={{ fontFamily: 'monospace', minWidth: 120 }}>{h.host}</Typography><Typography variant="body2" style={{ fontFamily: 'monospace', color: '#C9190B' }}>{h.actualValue}</Typography><Typography variant="caption" color="textSecondary">(expected: {h.expectedValue})</Typography></Box>))}</Box></Box>
            )}
          </div>
        </Collapse>
      </div>
    );
  };

  const renderStatusView = () => {
    const failedGroupEnabled = failedFindings.filter(f => selections[f.ruleId]?.enabled).length;
    const passingGroupEnabled = passingFindings.filter(f => selections[f.ruleId]?.enabled).length;

    return (
      <>
        {/* Failed rules section - always expanded */}
        {failedFindings.length > 0 && (
          <>
            <div className={classes.sectionHeader} role="button" tabIndex={0} data-testid="failed-rules-header">
              <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                <Chip label={`Rules with Failures (${failedFindings.length})`} size="small" style={{ backgroundColor: '#C9190B', color: '#fff', fontWeight: 600 }} />
                <Typography variant="body2" color="textSecondary">{failedGroupEnabled}/{failedFindings.length} selected</Typography>
              </Box>
            </div>
            {(['CAT_I', 'CAT_II', 'CAT_III'] as FindingSeverity[]).map(sev => {
              const sevFindings = failedFindings.filter(f => f.severity === sev);
              if (sevFindings.length === 0) return null;
              return (
                <React.Fragment key={sev}>
                  <Box display="flex" alignItems="center" style={{ gap: 8, marginTop: 8, marginBottom: 4, paddingLeft: 8 }}>
                    <Chip label={severityLabel[sev]} size="small" className={`${classes.severityChip} ${getSeverityClass(sev)}`} />
                    <Typography variant="caption" color="textSecondary">{sevFindings.length} rules</Typography>
                  </Box>
                  {sevFindings.map(finding => renderFinding(finding))}
                </React.Fragment>
              );
            })}
          </>
        )}

        {/* Passing rules section - collapsed by default */}
        {passingFindings.length > 0 && (
          <>
            <div
              className={classes.sectionHeader}
              role="button"
              tabIndex={0}
              data-testid="passing-rules-header"
              onClick={() => setPassingRulesExpanded(!passingRulesExpanded)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPassingRulesExpanded(!passingRulesExpanded); } }}
            >
              <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                <Chip label={`Compliant Rules (${passingFindings.length})`} size="small" style={{ backgroundColor: '#3E8635', color: '#fff', fontWeight: 600 }} />
                <Typography variant="body2" color="textSecondary">{passingGroupEnabled}/{passingFindings.length} selected</Typography>
              </Box>
              <IconButton size="small" aria-label={passingRulesExpanded ? 'Collapse compliant rules' : 'Expand compliant rules'}>
                {passingRulesExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </div>
            <Collapse in={passingRulesExpanded}>
              <div className={classes.passingNote}>
                <CheckCircleIcon className={classes.passingNoteIcon} />
                <Typography variant="body2" color="textSecondary">
                  These rules are currently compliant. Enable to enforce continuous compliance.
                </Typography>
              </div>
              {passingFindings.map(finding => renderFinding(finding))}
            </Collapse>
          </>
        )}
      </>
    );
  };

  const renderCategoryView = () => {
    return (
      <>
        {(['CAT_I', 'CAT_II', 'CAT_III'] as FindingSeverity[]).map(severity => {
          const group = groupedBySeverity[severity];
          if (group.length === 0) return null;
          const groupEnabled = group.filter(f => selections[f.ruleId]?.enabled).length;
          // Sort: failed first, then passing
          const sortedGroup = [...group].sort((a, b) => {
            const aFailed = a.failCount > 0 ? 0 : 1;
            const bFailed = b.failCount > 0 ? 0 : 1;
            return aFailed - bFailed;
          });
          return (
            <React.Fragment key={severity}>
              <div className={classes.sectionHeader}>
                <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                  <Chip label={severityLabel[severity]} size="small" className={`${classes.severityChip} ${getSeverityClass(severity)}`} />
                  <Typography variant="body2" color="textSecondary">{groupEnabled}/{group.length} selected</Typography>
                </Box>
              </div>
              {sortedGroup.map(finding => renderFinding(finding))}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  if (loading) return (<Box p={4}><Progress /><Typography variant="body2" align="center" style={{ marginTop: 16 }}>Loading findings for remediation...</Typography></Box>);

  return (
    <>
      <Breadcrumbs>
        <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>Compliance</Typography>
        {isEditMode ? (<Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance/remediations')}>Remediations</Typography>) : (<Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate(`/compliance/results/${jobId}`)}>Scan Results</Typography>)}
        <Typography>{isApplyMode ? 'Apply Remediation' : isEditMode ? 'Edit Remediation' : 'Remediation'}</Typography>
      </Breadcrumbs>
      <Box mt={2} />
      <div className={classes.profileHeader}>
        <Box flex={1} display="flex" flexDirection="column" style={{ gap: 12 }}>
          <TextField label="Remediation Name" variant="outlined" size="small" fullWidth required value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="e.g., production-web-servers-stig-v2r8" helperText={!profileName ? 'Name your remediation to enable auto-save' : undefined} inputProps={{ 'aria-label': 'Remediation profile name' }} />
          <TextField label="Description (optional)" variant="outlined" size="small" fullWidth multiline minRows={1} maxRows={3} value={profileDescription} onChange={e => setProfileDescription(e.target.value)} placeholder="e.g., STIG for production web tier" inputProps={{ 'aria-label': 'Remediation profile description' }} />
        </Box>
        <Box display="flex" flexDirection="column" alignItems="flex-end" justifyContent="flex-start" pt={1}>{renderAutoSaveStatus()}</Box>
      </div>
      {saveError && (<Box mb={2}><Typography color="error" variant="body2">{saveError}</Typography></Box>)}
      <div className={classes.summaryBar}>
        <div className={classes.summaryCount}>
          <Typography variant="body1"><strong>{failedFindings.length}</strong> rules with failures</Typography>
          <Typography variant="body1" color="textSecondary"><strong>{passingFindings.length}</strong> compliant</Typography>
          <Typography variant="body1" style={{ color: '#3E8635' }}><strong>{enabledCount}</strong> selected</Typography>
          <Typography variant="body1" color="textSecondary"><strong>{disabledCount}</strong> skipped</Typography>
          <Typography variant="body1" color="textSecondary"><strong>{totalAffectedHosts}</strong> hosts affected</Typography>
        </div>
        <div className={classes.bulkActions}>
          <ButtonGroup size="small" variant="outlined" className={classes.viewToggle} aria-label="View mode toggle">
            <Button onClick={() => setViewMode('status')} variant={viewMode === 'status' ? 'contained' : 'outlined'} color={viewMode === 'status' ? 'primary' : 'default'} data-testid="view-by-status">By Status</Button>
            <Button onClick={() => setViewMode('category')} variant={viewMode === 'category' ? 'contained' : 'outlined'} color={viewMode === 'category' ? 'primary' : 'default'} data-testid="view-by-category">By Category</Button>
          </ButtonGroup>
          <ButtonGroup size="small" variant="outlined" aria-label="Severity filter">
            <Button onClick={() => setSeverityFilter('all')} variant={severityFilter === 'all' ? 'contained' : 'outlined'} color={severityFilter === 'all' ? 'primary' : 'default'}>View All</Button>
            <Button onClick={() => setSeverityFilter('CAT_I')} variant={severityFilter === 'CAT_I' ? 'contained' : 'outlined'} color={severityFilter === 'CAT_I' ? 'primary' : 'default'}>CAT I</Button>
            <Button onClick={() => setSeverityFilter('CAT_II')} variant={severityFilter === 'CAT_II' ? 'contained' : 'outlined'} color={severityFilter === 'CAT_II' ? 'primary' : 'default'}>CAT II</Button>
            <Button onClick={() => setSeverityFilter('CAT_III')} variant={severityFilter === 'CAT_III' ? 'contained' : 'outlined'} color={severityFilter === 'CAT_III' ? 'primary' : 'default'}>CAT III</Button>
          </ButtonGroup>
          <Button size="small" variant="outlined" onClick={selectDisplayed}>Select Displayed</Button>
          <Button size="small" variant="outlined" onClick={deselectDisplayed}>Deselect Displayed</Button>
          <Button size="small" variant="outlined" onClick={selectAllFailed}>Select All Failed</Button>
          <Button size="small" variant="outlined" color="secondary" onClick={clearAll}>Deselect All</Button>
        </div>
      </div>
      {/* Search bar with select/deselect visible */}
      <Box display="flex" alignItems="center" mb={2} style={{ gap: 8 }}>
        <TextField
          placeholder="Search rules by name, ID, STIG ID, or description..."
          variant="outlined"
          size="small"
          style={{ flex: 1 }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: <Box mr={1} display="flex" alignItems="center"><span role="img" aria-label="search">🔍</span></Box>,
          }}
        />
        {searchQuery && (
          <>
            <Chip label={`${filteredFindings.length} of ${allFindings.length} rules`} size="small" variant="outlined" />
            <Button size="small" onClick={() => setSearchQuery('')}>
              Clear Search
            </Button>
          </>
        )}
        {(severityFilter !== 'all' || searchQuery) && (
          <Chip label={`Showing ${displayFindings.length} of ${allFindings.length} rules`} size="small" variant="outlined" />
        )}
      </Box>
      {viewMode === 'status' ? renderStatusView() : renderCategoryView()}
      <Divider style={{ margin: '24px 0' }} />
      <Box display="flex" justifyContent="flex-end" style={{ gap: 16 }}>
        <Button variant="contained" color="primary" size="large" startIcon={<PlayArrowIcon />} disabled={enabledCount === 0 || !canRemediate || launching || !profileName} title={!canRemediate ? 'You do not have permission to apply remediations' : !profileName ? 'Enter a remediation name first' : undefined}
          onClick={async () => {
            setLaunching(true);
            try {
              const enabledSelections = allFindings.filter(f => selections[f.ruleId]?.enabled).map(f => ({ ruleId: f.ruleId, enabled: true, scope: selections[f.ruleId].scope ?? 'failed_only' as const, parameters: selections[f.ruleId].parameters }));
              const effectiveScanId = isEditMode ? (editProfile?.scanId || editProfile?.complianceProfileId || '') : (jobId ?? '');
              const saved = await api.saveRemediationProfile({ id: savedProfileId ?? (isEditMode ? editProfile?.id : undefined), name: profileName || editProfile?.name || 'Remediation', description: profileDescription || editProfile?.description || '', complianceProfileId: editProfile?.complianceProfileId || resolvedProfileId, scanId: effectiveScanId, selections: enabledSelections });
              const params = new URLSearchParams(); params.set('profileId', saved.id); params.set('scanId', effectiveScanId);
              navigate(`/compliance/execute/${effectiveScanId}?${params.toString()}`);
            } catch (err) { setSaveError(err instanceof Error ? err.message : 'Failed to prepare remediation'); setLaunching(false); }
          }}
        >{launching ? 'Preparing...' : `Apply Remediation (${enabledCount} rules, ${totalAffectedHosts} hosts)`}</Button>
      </Box>
    </>
  );
};

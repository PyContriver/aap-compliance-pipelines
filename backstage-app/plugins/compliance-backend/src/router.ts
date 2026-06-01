/**
 * Express router for the compliance backend plugin.
 *
 * All routes are prefixed with /api/compliance by the plugin registration.
 *
 * Permission model (Option A+C):
 *   - Read-only endpoints: open to all authenticated users (auth handled
 *     by httpRouter auth policies in plugin.ts).
 *   - Mutating endpoints: gated by catalogEntityCreatePermission when
 *     httpAuth and permissions services are provided (production mode).
 *     When omitted (development mode), permission checks are skipped.
 *   - AAP layer: per-user AAP tokens passed via x-aap-token header.
 */
import express from 'express';
import Router from 'express-promise-router';
import {
  HttpAuthService,
  LoggerService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';

import { randomUUID } from 'crypto';

import { ComplianceService, buildRuleMetadataRecords } from './service/ComplianceService';
import { ComplianceDatabase } from './database/ComplianceDatabase';
import { validatePlatform } from './service/PlatformValidator';

import type {
  LaunchScanRequest,
  LaunchRemediationRequest,
  SaveRemediationProfileRequest,
  SaveProfileRequest,
  IngestFinding,
} from '@aap-compliance/common';

export interface RouterOptions {
  logger: LoggerService;
  service: ComplianceService;
  database: ComplianceDatabase;
  /** Default retention from app-config.yaml compliance.retentionDays */
  configRetentionDays?: number;
  /** Provided in production mode for permission enforcement. */
  httpAuth?: HttpAuthService;
  /** Provided in production mode for permission enforcement. */
  permissions?: PermissionsService;
}

// ─── Token extraction ─────────────────────────────────────────────────

/**
 * Extract the user's AAP OAuth2 token from the request.
 *
 * In the upstream Ansible Portal, the user's AAP token flows through the
 * scaffolder via AAPTokenField. For our REST API, the frontend passes it
 * as the `x-aap-token` header. When the auth-backend-module-rhaap-provider
 * is integrated in production, this token is the user's Gateway OAuth2
 * access token — AAP RBAC is then enforced per-user.
 *
 * Returns undefined when no token is present (the backend falls back to
 * the service token from app-config.yaml).
 */
function getUserAapToken(req: express.Request): string | undefined {
  const header = req.headers['x-aap-token'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return undefined;
}

// ─── Validation helpers ────────────────────────────────────────────────

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val > 0;
}

function isBoolean(val: unknown): val is boolean {
  return typeof val === 'boolean';
}

function isArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

function isValidScanId(scanId: string): boolean {
  return typeof scanId === 'string' && scanId.length > 0 && scanId.length <= 128
    && /^[a-zA-Z0-9_-]+$/.test(scanId);
}

// ─── Permission enforcement ──────────────────────────────────────────

/**
 * Check whether the request is authorized for the given permission.
 *
 * When httpAuth and permissions services are available (production mode),
 * extracts credentials from the request and evaluates the permission
 * via the Backstage permissions framework. Returns true if allowed.
 *
 * When the services are not provided (development mode), always returns
 * true so that standalone dev works without auth infrastructure.
 */
async function requirePermission(
  req: express.Request,
  res: express.Response,
  httpAuth?: HttpAuthService,
  permissions?: PermissionsService,
): Promise<boolean> {
  // Development mode: no auth services, skip permission check
  if (!httpAuth || !permissions) {
    return true;
  }

  try {
    const credentials = await httpAuth.credentials(req);
    const [decision] = await permissions.authorize(
      [{ permission: catalogEntityCreatePermission }],
      { credentials },
    );

    if (decision.result !== AuthorizeResult.ALLOW) {
      res.status(403).json({
        error: 'Forbidden: this action requires admin permissions',
      });
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(403).json({ error: `Authorization failed: ${msg}` });
    return false;
  }
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, service, database, httpAuth, permissions, configRetentionDays } = options;
  const router = Router();
  const recentRemediations = new Map<string, number>();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [key, ts] of recentRemediations) {
      if (ts < cutoff) recentRemediations.delete(key);
    }
  }, 60_000);

  router.use((req, res, next) => {
    if (req.path.startsWith('/findings/ingest')) return next();
    express.json({ limit: '1mb' })(req, res, next);
  });

  // ─── Health ─────────────────────────────────────────────────────────

  // TODO(P3): retentionDays is per-process; persisted settings planned for multi-replica deployments.
  let retentionDays = configRetentionDays ?? 90;

  // Throttle stale-scan Controller API checks (scanId → lastCheckedMs)
  const staleScanThrottle = new Map<string, number>();
  const STALE_SCAN_CHECK_INTERVAL_MS = 30_000;

  // Prevent duplicate event parsing when parallel requests race
  const parseInProgress = new Set<string>();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      dataSource: service.getDataSource(),
      retentionDays,
    });
  });

  router.post('/settings', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    if (req.body.retentionDays && typeof req.body.retentionDays === 'number') {
      retentionDays = Math.max(7, Math.min(365, req.body.retentionDays));
      logger.info(`Data retention updated to ${retentionDays} days`);
    }
    res.json({ retentionDays });
  });

  router.post('/cleanup', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    try {
      const deleted = await database.cleanupOldFindings(retentionDays);
      logger.info(`Manual cleanup: removed ${deleted} findings older than ${retentionDays} days`);
      res.json({ deleted, retentionDays });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Cleanup failed: ${msg}`);
      res.status(500).json({ error: 'Data cleanup failed' });
    }
  });

  // ─── Profiles ───────────────────────────────────────────────────────

  router.get('/profiles', async (_req, res) => {
    const profiles = await service.getProfiles();
    res.json(profiles);
  });

  // ─── Scan history ───────────────────────────────────────────────────

  router.get('/scans', async (req, res) => {
    const userToken = getUserAapToken(req);
    const scans = await database.getRecentScans(50);

    // Auto-update stale running/pending records by checking Controller
    if (service.getDataSource() === 'live') {
      const now = Date.now();
      const staleScans = scans.filter(
        s => (s.status === 'running' || s.status === 'pending') && s.workflowJobId
          && now - (staleScanThrottle.get(s.id) ?? 0) > STALE_SCAN_CHECK_INTERVAL_MS,
      );
      await Promise.all(staleScans.map(async scan => {
        try {
          staleScanThrottle.set(scan.id, now);
          let status;
          if (scan.scanner === 'remediation') {
            status = await service.getJobStatus(scan.workflowJobId!, userToken);
          } else {
            try {
              status = await service.getWorkflowJobStatus(scan.workflowJobId!, userToken);
            } catch (err) {
              logger.debug(`WJT status failed for scan ${scan.id}, falling back to JT: ${err instanceof Error ? err.message : String(err)}`);
              status = await service.getJobStatus(scan.workflowJobId!, userToken);
            }
          }
          const terminal = ['successful', 'failed', 'error', 'canceled'];
          if (terminal.includes(status.status)) {
            const newStatus = status.status === 'successful' ? 'completed' : 'failed';
            await database.updateScanStatus(scan.id, newStatus, status.finished ?? new Date().toISOString());
            scan.status = newStatus as typeof scan.status;
            scan.completedAt = status.finished ?? new Date().toISOString();
          }
        } catch (err) {
          logger.debug(`Stale scan check failed for ${scan.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }));
    }

    res.json(scans);
  });

  // ─── Inventories ────────────────────────────────────────────────────

  router.get('/inventories', async (req, res) => {
    const userToken = getUserAapToken(req);
    const inventories = await service.getInventories(userToken);
    res.json(inventories);
  });

  router.get('/scans/:scanId', async (req, res) => {
    const { scanId } = req.params;
    const userToken = getUserAapToken(req);
    if (!scanId || scanId.length > 128) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }
    try {
      let scan = await database.getScanById(scanId);
      if (!scan && /^\d+$/.test(scanId)) {
        scan = await database.getScanByWorkflowJobId(Number(scanId));
      }
      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      // Lazily fetch and cache error details for failed scans
      if (
        scan.status === 'failed' &&
        scan.errorDetails === null &&
        scan.workflowJobId
      ) {
        try {
          const details = await service.fetchScanErrorDetails(
            scan.workflowJobId,
            userToken,
          );
          if (details) {
            await database.updateScanErrorDetails(scan.id, details);
            scan.errorDetails = details;
          }
        } catch (err) {
          logger.debug(`Error details fetch failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      res.json(scan);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get scan ${scanId}: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve scan details' });
    }
  });

  // ─── Workflow job templates ─────────────────────────────────────────

  router.get('/workflow-templates', async (req, res) => {
    const userToken = getUserAapToken(req);
    const nameFilter = req.query.name as string | undefined;
    const templates = await service.getWorkflowTemplates(nameFilter, userToken);
    res.json(templates);
  });

  // ─── Job template detail ────────────────────────────────────────────

  router.get('/job-templates/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid job template ID' });
      return;
    }
    const userToken = getUserAapToken(req);
    try {
      const detail = await service.getJobTemplateDetail(id, userToken);
      res.json(detail);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to fetch JT detail for ${id}: ${msg}`);
      res.status(502).json({ error: 'Failed to fetch job template details from Controller' });
    }
  });

  // ─── Scan ───────────────────────────────────────────────────────────

  router.post('/scan/validate', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const { profileId, inventoryId } = req.body;
    const userToken = getUserAapToken(req);

    if (!isNonEmptyString(profileId)) {
      res.status(400).json({ error: 'profileId is required' });
      return;
    }
    if (!isPositiveInteger(inventoryId)) {
      res.status(400).json({ error: 'inventoryId must be a positive integer' });
      return;
    }

    try {
      const profile = await database.getProfile(profileId);
      if (!profile?.platformSpec || profile.platformSpec.scanner_validates) {
        res.json({ valid: true, matchedHosts: [], mismatchedHosts: [], factsAvailable: true });
        return;
      }

      const hostFacts = await service.getInventoryHostFacts(inventoryId, userToken);
      const factsAvailable = hostFacts.some(h => !!(h.ansible_os_family || h.ansible_distribution_major_version || h.device_type));
      const result = validatePlatform(profile.platformSpec, hostFacts);
      res.json({ ...result, factsAvailable });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Platform validation failed: ${msg}`);
      res.status(500).json({ error: 'Platform validation failed' });
    }
  });

  router.post('/scan', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const body = req.body;
    const userToken = getUserAapToken(req);

    // Validate required fields
    if (!isNonEmptyString(body.profileId)) {
      res.status(400).json({ error: 'profileId is required and must be a non-empty string' });
      return;
    }
    if (!isPositiveInteger(body.inventoryId)) {
      res.status(400).json({ error: 'inventoryId is required and must be a positive integer' });
      return;
    }
    if (body.workflowTemplateId !== undefined && body.workflowTemplateId !== null && !isPositiveInteger(body.workflowTemplateId)) {
      res.status(400).json({ error: 'workflowTemplateId must be a positive integer when provided' });
      return;
    }
    const validScanTypes = ['assessment', 'verification'];
    if (body.scanType && !validScanTypes.includes(body.scanType)) {
      res.status(400).json({ error: `scanType must be one of: ${validScanTypes.join(', ')}` });
      return;
    }

    const scanRequest: LaunchScanRequest = {
      profileId: body.profileId,
      inventoryId: body.inventoryId,
      evaluateOnly: body.evaluateOnly ?? true,
      limit: body.limit,
      workflowTemplateId: body.workflowTemplateId ?? undefined,
      gatherFacts: body.gatherFacts ?? false,
    };

    logger.info(`Launching scan for profile=${scanRequest.profileId}`);

    let scanRecordId: string | undefined;
    try {
      // Create scan record BEFORE launching so scan_id is available as extra_var
      // Generate a per-scan ingest token for secure Direct POST
      const ingestToken = randomUUID();

      const scanRecord = await database.createScan({
        profileId: scanRequest.profileId,
        inventoryId: scanRequest.inventoryId,
        scanner: 'oscap',
        scanType: body.scanType || 'assessment',
        workflowJobId: null,
        status: 'pending',
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorDetails: null,
      });
      scanRecordId = scanRecord.id;
      await database.storeIngestToken(scanRecord.id, ingestToken);

      const result = await service.launchScan(scanRequest, userToken, scanRecord.id, ingestToken);

      // Update scan record with the workflow job ID
      await database.updateScanWorkflowJobId(scanRecord.id, result.workflowJobId);

      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to launch scan: ${msg}`);
      if (scanRecordId) {
        await database.updateScanStatus(scanRecordId, 'failed', new Date().toISOString()).catch(() => {});
        await database.updateScanErrorDetails(scanRecordId, msg).catch(() => {});
      }
      res.status(500).json({ error: 'Failed to launch compliance scan' });
    }
  });

  // ─── Findings helpers ────────────────────────────────────────────────

  type ScanResolution = {
    resolvedScanId: string | undefined;
    workflowJobId: number | undefined;
    dbScan: Awaited<ReturnType<typeof database.getScanByWorkflowJobId>> | undefined;
  };

  async function resolveScanId(scanId: string | undefined): Promise<ScanResolution> {
    let resolvedScanId = scanId;
    let workflowJobId: number | undefined;
    let dbScan: ScanResolution['dbScan'];

    if (scanId) {
      const match = scanId.match(/^(?:scan-)?(\d+)$/);
      if (match) {
        workflowJobId = Number(match[1]);
        dbScan = await database.getScanByWorkflowJobId(workflowJobId) ?? undefined;
        if (dbScan) {
          resolvedScanId = dbScan.id;
        }
      }
    }
    return { resolvedScanId, workflowJobId, dbScan };
  }

  async function savePostureFromFindings(
    findings: Array<{ status: string; host: string; ruleId: string }>,
    profileId: string,
    inventoryId?: number,
    scanId?: string,
  ): Promise<void> {
    const passCount = findings.filter(f => f.status === 'pass').length;
    const failCount = findings.filter(f => f.status === 'fail').length;
    const uniqueHosts = new Set(findings.map(f => f.host)).size;
    const uniqueRules = new Set(findings.map(f => f.ruleId)).size;
    const total = passCount + failCount;
    await database.savePostureSnapshot({
      profileId,
      inventoryId,
      scanId,
      timestamp: new Date().toISOString(),
      totalHosts: uniqueHosts,
      totalRules: uniqueRules,
      passCount,
      failCount,
      compliancePct: total > 0 ? Math.round((passCount / total) * 100) : 0,
    });
    logger.info(`Saved posture snapshot for profile=${profileId} inventory=${inventoryId ?? 'unknown'}`);
  }

  async function fetchLiveFindings(
    resolvedScanId: string,
    workflowJobId: number,
    dbScan: ScanResolution['dbScan'],
    userToken: string | undefined,
  ): Promise<unknown[] | null> {
    let status;
    try {
      status = await service.getWorkflowJobStatus(workflowJobId, userToken);
    } catch (err) {
      logger.debug(`WJT status failed for ${workflowJobId}, falling back to JT: ${err instanceof Error ? err.message : String(err)}`);
      status = await service.getJobStatus(workflowJobId, userToken);
    }

    const st = status.status.toLowerCase();
    if (st !== 'successful' && st !== 'failed') {
      logger.info(`Workflow ${workflowJobId} status is "${status.status}" — not yet ready to parse`);
      return null;
    }

    const effectiveScanId = dbScan?.id ?? resolvedScanId;

    if (parseInProgress.has(effectiveScanId)) {
      await new Promise(r => setTimeout(r, 2000));
      const dbFindings = await database.getFindingsByScanId(effectiveScanId);
      if (dbFindings.length > 0) {
        return service.aggregateFindingsWithMetadata(dbFindings);
      }
    }

    parseInProgress.add(effectiveScanId);
    let parsed;
    try {
      parsed = await service.fetchAndParseResults(workflowJobId, effectiveScanId, userToken);
    } finally {
      parseInProgress.delete(effectiveScanId);
    }

    if (dbScan) {
      const scanStatus = st === 'successful' ? 'completed' : 'failed';
      await database.updateScanStatus(dbScan.id, scanStatus, new Date().toISOString());
    }

    if (parsed.length > 0) {
      try {
        await savePostureFromFindings(parsed, dbScan?.profileId ?? resolvedScanId, dbScan?.inventoryId, dbScan?.id);
      } catch (snapshotError) {
        logger.warn(`Failed to save posture snapshot: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`);
      }

      const freshFindings = await database.getFindingsByScanId(effectiveScanId);
      if (freshFindings.length > 0) {
        return service.aggregateFindingsWithMetadata(freshFindings);
      }
      return service.aggregateFindingsWithMetadata(parsed);
    }

    return null;
  }

  // ─── Findings ───────────────────────────────────────────────────────

  router.get('/findings', async (req, res) => {
    const scanId = req.query.scanId as string | undefined;
    const userToken = getUserAapToken(req);

    if (scanId && !isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    const { resolvedScanId, workflowJobId, dbScan } = await resolveScanId(scanId);

    // Check DB for stored findings (skip if numeric ID had no matching scan record)
    const skipDbLookup = workflowJobId !== undefined && !dbScan;
    if (resolvedScanId && !skipDbLookup) {
      const dbFindings = await database.getFindingsByScanId(resolvedScanId);
      if (dbFindings.length > 0) {
        res.json(await service.aggregateFindingsWithMetadata(dbFindings));
        return;
      }
    }

    // In live mode, fetch and parse results from Controller
    if (resolvedScanId && service.getDataSource() === 'live' && workflowJobId) {
      try {
        const liveResult = await fetchLiveFindings(resolvedScanId, workflowJobId, dbScan, userToken);
        if (liveResult) {
          res.json(liveResult);
          return;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to fetch/parse results for scan ${resolvedScanId}: ${msg}`);
      }
    }

    // Fall through to the service (mock data or DB-based in live mode)
    const findings = await service.getFindings(resolvedScanId);
    res.json(findings);
  });

  // ─── Previous scan findings (for verification comparison) ──────────

  router.get('/previous-findings', async (req, res) => {
    const scanId = req.query.scanId as string | undefined;

    if (!scanId) {
      res.status(400).json({ error: 'scanId query parameter is required' });
      return;
    }

    if (!isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    try {
      // Resolve the current scan — try by scan UUID first, then by workflowJobId
      let currentScan = await database.getScanById(scanId);
      if (!currentScan && /^\d+$/.test(scanId)) {
        currentScan = await database.getScanByWorkflowJobId(Number(scanId));
      }

      if (!currentScan) {
        res.json([]);
        return;
      }

      // Find the previous assessment scan for the same profile
      const previousScan = await database.getPreviousScan(currentScan);
      if (!previousScan) {
        res.json([]);
        return;
      }

      // Get findings for the previous scan
      const dbFindings = await database.getFindingsByScanId(previousScan.id);
      if (dbFindings.length > 0) {
        res.json(await service.aggregateFindingsWithMetadata(dbFindings));
        return;
      }

      // Fall through to service for mock data
      const findings = await service.getFindings(previousScan.id);
      res.json(findings);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get previous findings: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve previous scan findings' });
    }
  });

  // ─── Findings ingest (direct POST from playbook) ────────────────────
  // SECURITY NOTE: This endpoint intentionally bypasses Backstage httpAuth.
  // The playbook callback cannot carry Backstage identity tokens. Security is
  // provided by per-scan ingest tokens (ADR-010) validated against the DB.
  // Consider rate-limiting or HMAC in production deployments.

  router.post('/findings/ingest', express.json({ limit: '50mb' }), async (req, res) => {
    const body = req.body;
    const scanId = body.scanId as string | undefined;
    const ingestToken = body.ingestToken as string | undefined;
    const findings = body.findings as Array<Record<string, unknown>> | undefined;

    if (!scanId || !findings || !Array.isArray(findings)) {
      res.status(400).json({ error: 'scanId (string) and findings (array) are required' });
      return;
    }

    if (!isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    if (findings.length > 50000) {
      res.status(400).json({ error: 'Findings count exceeds maximum allowed (50000)' });
      return;
    }

    const MAX_FINDING_SIZE = 100 * 1024;
    for (let i = 0; i < findings.length; i++) {
      const size = JSON.stringify(findings[i]).length;
      if (size > MAX_FINDING_SIZE) {
        res.status(400).json({ error: `findings[${i}] exceeds maximum size (${MAX_FINDING_SIZE} bytes)` });
        return;
      }
    }

    try {
      const scan = await database.getScanById(scanId);
      if (!scan) {
        res.status(404).json({ error: `Scan ${scanId} not found` });
        return;
      }

      // Validate per-scan ingest token to prevent unauthorized data injection.
      // Tokens are persisted in the database (migration 004) so they survive
      // restarts and work across replicas. If no stored token exists (e.g.,
      // the scan was not created via POST /scan), reject the request.
      const expectedToken = await database.getIngestToken(scanId);
      if (!expectedToken || expectedToken !== ingestToken) {
        res.status(403).json({ error: 'Invalid ingest token' });
        return;
      }

      const mapped = findings.map(raw => service.mapRawFindingPublic(
        raw as IngestFinding,
        (raw.host as string) || 'unknown',
        scanId,
      ));

      const count = await database.saveFindingsForScan(scanId, mapped);

      try {
        const metadataRecords = buildRuleMetadataRecords(findings as Array<Record<string, unknown>>);
        const metaCount = await database.upsertRuleMetadata(metadataRecords);
        logger.info(`Upserted ${metaCount} rule metadata records`);
      } catch (metaErr) {
        logger.warn(`Rule metadata upsert failed (non-fatal): ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
      }

      await database.updateScanStatus(scanId, 'completed', new Date().toISOString());

      try {
        await savePostureFromFindings(mapped, scan.profileId, scan.inventoryId, scan.id);
      } catch (err) {
        logger.debug(`Posture snapshot failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`);
      }

      logger.info(`Ingested ${count} findings for scan ${scanId} via direct POST`);
      res.status(201).json({ scanId, findingsCount: count });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to ingest findings: ${msg}`);
      res.status(500).json({ error: 'Failed to ingest findings' });
    }
  });

  // ─── Workflow job status (for polling) ──────────────────────────────

  router.get('/workflow-status/:jobId', async (req, res) => {
    const userToken = getUserAapToken(req);
    const jobId = Number(req.params.jobId);
    if (Number.isNaN(jobId)) {
      res.status(400).json({ error: 'jobId must be a number' });
      return;
    }
    try {
      let status;
      try {
        status = await service.getWorkflowJobStatus(jobId, userToken);
      } catch (err) {
        logger.debug(`WJT status failed for ${jobId}, falling back to JT: ${err instanceof Error ? err.message : String(err)}`);
        status = await service.getJobStatus(jobId, userToken);
      }
      res.json(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get workflow status for ${jobId}: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve job status' });
    }
  });

  router.get('/job-status/:jobId', async (req, res) => {
    const userToken = getUserAapToken(req);
    const jobId = Number(req.params.jobId);
    if (Number.isNaN(jobId)) {
      res.status(400).json({ error: 'jobId must be a number' });
      return;
    }
    try {
      const status = await service.getJobStatus(jobId, userToken);
      res.json(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get job status for ${jobId}: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve job status' });
    }
  });

  // ─── Workflow nodes ─────────────────────────────────────────────────

  router.get('/workflow-nodes/:jobId', async (req, res) => {
    const userToken = getUserAapToken(req);
    const jobId = Number(req.params.jobId);
    if (Number.isNaN(jobId)) {
      res.status(400).json({ error: 'jobId must be a number' });
      return;
    }
    try {
      let nodes: import('@aap-compliance/common').WorkflowNode[];
      try {
        nodes = await service.getWorkflowNodes(jobId, userToken);
      } catch (err) {
        logger.debug(`Workflow nodes failed for ${jobId} (likely a JT, not WJT): ${err instanceof Error ? err.message : String(err)}`);
        nodes = [];
      }
      res.json(nodes);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get workflow nodes for ${jobId}: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve workflow nodes' });
    }
  });

  // ─── Job events ─────────────────────────────────────────────────────

  router.get('/job-events/:jobId', async (req, res) => {
    const userToken = getUserAapToken(req);
    const jobId = Number(req.params.jobId);
    if (Number.isNaN(jobId)) {
      res.status(400).json({ error: 'jobId must be a number' });
      return;
    }
    try {
      const events = await service.getJobEvents(jobId, userToken);
      res.json(events);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get job events for ${jobId}: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve job events' });
    }
  });

  // ─── Remediation ────────────────────────────────────────────────────

  router.post('/remediate', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const body = req.body;
    const userToken = getUserAapToken(req);

    // Validate required fields
    if (!isNonEmptyString(body.profileId)) {
      res.status(400).json({ error: 'profileId is required and must be a non-empty string' });
      return;
    }
    if (!isPositiveInteger(body.inventoryId)) {
      res.status(400).json({ error: 'inventoryId is required and must be a positive integer' });
      return;
    }
    if (!isArray(body.selections)) {
      res.status(400).json({ error: 'selections is required and must be an array' });
      return;
    }

    // Validate each selection
    for (let i = 0; i < body.selections.length; i++) {
      const sel = body.selections[i];
      if (!isNonEmptyString(sel?.ruleId)) {
        res.status(400).json({ error: `selections[${i}].ruleId is required and must be a non-empty string` });
        return;
      }
      if (!isBoolean(sel?.enabled)) {
        res.status(400).json({ error: `selections[${i}].enabled is required and must be a boolean` });
        return;
      }
    }

    const remediateRequest: LaunchRemediationRequest = {
      profileId: body.profileId,
      inventoryId: body.inventoryId,
      selections: body.selections,
      limit: body.limit,
      scanId: body.scanId,
    };

    const enabledCount = body.selections.filter((s: { enabled: boolean }) => s.enabled).length;
    logger.info(
      `Launching remediation for profile=${remediateRequest.profileId}` +
      ` with ${body.selections.length} selections (${enabledCount} enabled)` +
      (body.scanId ? ` (scan=${body.scanId})` : ''),
    );

    try {
      // Concurrent execution guard (ADR-014 §6): create execution record
      // with status='pending'. The partial unique index on (inventory_id)
      // WHERE status IN ('pending','running') enforces at most one active
      // remediation per inventory — no TOCTOU race.
      const execution = await database.createExecution({
        remediationProfileId: body.remediationProfileId || body.profileId,
        inventoryId: body.inventoryId,
        informingScanId: body.scanId || undefined,
        createdBy: undefined, // TODO: extract from Backstage identity
      });

      if (!execution) {
        const running = await database.getRunningExecutionForInventory(body.inventoryId);
        logger.warn(`Concurrent execution guard: blocked remediation on inventory ${body.inventoryId}`);
        res.status(409).json({
          error: {
            name: 'ConflictError',
            message: 'A remediation is already running on this inventory',
            detail: running ? {
              executionId: running.id,
              profileId: running.remediationProfileId,
              startedAt: running.startedAt,
              status: running.status,
            } : undefined,
          },
        });
        return;
      }

      // Use the latest findings FOR THIS PROFILE for host scoping.
      const findings = await service.getFindings(undefined, remediateRequest.profileId);
      logger.info(`Findings for remediation (profile=${remediateRequest.profileId}): ${findings.length} rules`);

      const plan = service.buildRemediationPlan(remediateRequest.selections, findings);
      logger.info(
        `Remediation plan: ${plan.groups.length} groups, ${plan.totalRules} rules, ${plan.totalHosts} hosts`,
      );

      // Store plan summary on execution record
      await database.updateExecutionStatus(execution.id, {
        status: 'pending',
        rulesApplied: plan.totalRules,
        hostsTargeted: plan.totalHosts,
      });

      let result;
      try {
        result = await service.launchRemediation(remediateRequest, findings, userToken);
      } catch (launchErr) {
        // Launch failed — mark execution as failed so the inventory is unlocked
        await database.updateExecutionStatus(execution.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
        });
        throw launchErr;
      }

      // Update execution with job IDs and mark as running
      await database.updateExecutionStatus(execution.id, {
        status: 'running',
        primaryJobId: result.workflowJobId,
        allJobIds: result.allJobIds || [result.workflowJobId],
      });

      // Dual-write: scan record for active jobs banner (deprecated in Phase 3).
      // Isolated so its failure doesn't block the response.
      try {
        await database.createScan({
          profileId: remediateRequest.profileId,
          inventoryId: remediateRequest.inventoryId,
          scanner: 'remediation',
          scanType: 'assessment',
          workflowJobId: result.workflowJobId,
          status: 'running',
          startedAt: new Date().toISOString(),
          completedAt: null,
          errorDetails: null,
        });
      } catch (scanErr) {
        logger.warn(`Failed to create dual-write scan record: ${scanErr instanceof Error ? scanErr.message : scanErr}`);
      }

      res.json({ ...result, executionId: execution.id, plan });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to launch remediation: ${msg}`);
      res.status(500).json({ error: 'Failed to launch remediation' });
    }
  });

  // ─── Remediation executions (ADR-014) ─────────────────────────────

  router.get('/remediation-executions', async (req, res) => {
    const profileId = req.query.profileId as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    if (profileId) {
      const executions = await database.getExecutionsByProfileId(profileId, limit);
      res.json(executions);
    } else {
      res.status(400).json({ error: 'profileId query parameter is required' });
    }
  });

  router.get('/remediation-executions/:id', async (req, res) => {
    const execution = await database.getExecutionById(req.params.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }
    res.json(execution);
  });

  router.patch('/remediation-executions/:id', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const execution = await database.getExecutionById(req.params.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }
    const validStatuses = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
    const { status, completedAt, elapsedSeconds, rulesApplied, rulesFailed,
            hostsTargeted, hostsSucceeded, hostsFailed, primaryJobId, allJobIds } = req.body;
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }
    await database.updateExecutionStatus(req.params.id, {
      status: status ?? execution.status,
      completedAt, elapsedSeconds, rulesApplied, rulesFailed,
      hostsTargeted, hostsSucceeded, hostsFailed, primaryJobId, allJobIds,
    });
    const updated = await database.getExecutionById(req.params.id);
    res.json(updated);
  });

  // ─── Remediation profile status (ADR-014 §2) ──────────────────────

  router.patch('/remediation-profiles/:id', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const { status } = req.body;
    if (!status || !['draft', 'saved', 'archived'].includes(status)) {
      res.status(400).json({ error: 'status must be one of: draft, saved, archived' });
      return;
    }
    // Prevent archiving a profile pinned as golden standard (ADR-014 §7 / Q6)
    if (status === 'archived') {
      const isPinned = await database.isProfilePinnedAsBaseline(req.params.id);
      if (isPinned) {
        res.status(409).json({ error: 'Cannot archive a profile pinned as a golden standard. Unpin it first.' });
        return;
      }
    }
    const updated = await database.updateRemediationProfileStatus(req.params.id, status);
    if (!updated) {
      res.status(404).json({ error: 'Remediation profile not found' });
      return;
    }
    const profile = await database.getRemediationProfile(req.params.id);
    res.json(profile);
  });

  // ─── Dashboard stats ───────────────────────────────────────────────

  router.get('/dashboard', async (_req, res) => {
    const stats = await service.getDashboardStats();
    res.json(stats);
  });

  router.get('/dashboard/scans-for-profile/:profileId', async (req, res) => {
    const { profileId } = req.params;
    try {
      const stats = await service.getDashboardStats();
      const fw = stats.frameworkScores.find(f => f.profileId === profileId);
      res.json(fw?.contributingScans ?? []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get contributing scans: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve contributing scans' });
    }
  });

  // ─── Posture history ────────────────────────────────────────────────

  router.get('/posture', async (req, res) => {
    const profileId = req.query.profileId as string | undefined;
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const history = await service.getPostureHistory(profileId, days);
    res.json(history);
  });

  // ─── Remediations (saved rule selections) ──────────────────────────

  router.get('/remediation-profiles', async (req, res) => {
    // Stale execution recovery (ADR-014 architect review): on list load,
    // check for executions stuck in 'pending'/'running' >4 hours.
    // Query Controller for actual job status before marking as failed.
    try {
      const stale = await database.getStaleRunningExecutions(4);
      for (const exec of stale) {
        let resolvedStatus: 'succeeded' | 'failed' = 'failed';
        if (exec.primaryJobId) {
          try {
            const job = await service.getJobStatus(exec.primaryJobId);
            if (job.status === 'running' || job.status === 'pending' || job.status === 'waiting' || job.status === 'new') {
              continue; // still running on Controller — don't mark as failed
            }
            resolvedStatus = job.status === 'successful' ? 'succeeded' : 'failed';
          } catch (controllerErr) {
            logger.debug(`Stale recovery: Controller unreachable for execution ${exec.id}, skipping (fail-safe): ${controllerErr instanceof Error ? controllerErr.message : controllerErr}`);
            continue;
          }
        }
        logger.warn(`Recovering stale execution ${exec.id} (started ${exec.startedAt}) → ${resolvedStatus}`);
        await database.updateExecutionStatus(exec.id, {
          status: resolvedStatus,
          completedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn(`Stale execution recovery failed: ${err instanceof Error ? err.message : err}`);
    }

    const statusFilter = req.query.status as string | undefined;
    const validStatuses = ['draft', 'saved', 'archived', 'all'];
    const filter = statusFilter && validStatuses.includes(statusFilter)
      ? statusFilter as 'draft' | 'saved' | 'archived' | 'all'
      : undefined;
    const profiles = await service.getRemediationProfiles(filter);
    res.json(profiles);
  });

  router.get('/remediation-profiles/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const profile = await service.getRemediationProfile(id);
      if (!profile) {
        res.status(404).json({ error: 'Remediation profile not found' });
        return;
      }
      res.json(profile);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get remediation profile: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve remediation profile' });
    }
  });

  router.post('/remediation-profiles', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const body = req.body;

    // Validate required fields
    if (!isNonEmptyString(body.name)) {
      res.status(400).json({ error: 'name is required and must be a non-empty string' });
      return;
    }
    if (!isArray(body.selections)) {
      res.status(400).json({ error: 'selections is required and must be an array' });
      return;
    }

    const saveRequest: SaveRemediationProfileRequest = {
      id: body.id,
      name: body.name,
      description: body.description ?? '',
      complianceProfileId: body.complianceProfileId ?? '',
      scanId: body.scanId,
      selections: body.selections,
    };

    try {
      const profile = await service.saveRemediationProfile(saveRequest);
      res.status(201).json(profile);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save remediation: ${msg}`);
      res.status(500).json({ error: 'Failed to save remediation profile' });
    }
  });

  router.delete('/remediation-profiles/:id', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const { id } = req.params;
    try {
      const deleted = await service.deleteRemediationProfile(id);
      if (!deleted) {
        res.status(404).json({ error: 'Remediation profile not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Only draft') || msg.includes('Cannot delete') || msg.includes('RESTRICT')) {
        res.status(409).json({ error: msg });
        return;
      }
      logger.error(`Failed to delete remediation profile: ${msg}`);
      res.status(500).json({ error: 'Failed to delete remediation profile' });
    }
  });

  // ─── Compliance profile registry ────────────────────────────────────

  router.get('/compliance-profiles', async (_req, res) => {
    const profiles = await database.listProfiles();

    // TODO: N+1 queries — replace with single aggregation query when profile count grows
    const enriched = await Promise.all(
      profiles.map(async c => {
        const findings = await database.getLatestFindings(c.id);
        const uniqueRules = new Set(findings.map(f => f.ruleId)).size;
        return { ...c, ruleCount: uniqueRules };
      }),
    );

    res.json(enriched);
  });

  router.get('/compliance-profiles/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const profile = await database.getProfile(id);
      if (!profile) {
        res.status(404).json({ error: 'Compliance profile not found' });
        return;
      }
      res.json(profile);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get compliance profile: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve compliance profile' });
    }
  });

  router.post('/compliance-profiles', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const body = req.body;

    // Validate required fields
    if (!isNonEmptyString(body.displayName)) {
      res.status(400).json({ error: 'displayName is required and must be a non-empty string' });
      return;
    }
    if (!isNonEmptyString(body.framework)) {
      res.status(400).json({ error: 'framework is required and must be a non-empty string' });
      return;
    }
    if (body.workflowTemplateId !== undefined && body.workflowTemplateId !== null && !isPositiveInteger(body.workflowTemplateId)) {
      res.status(400).json({ error: 'workflowTemplateId must be a positive integer when provided' });
      return;
    }

    // Validate platformSpec if provided
    if (body.platformSpec !== undefined && body.platformSpec !== null) {
      if (typeof body.platformSpec !== 'object' || Array.isArray(body.platformSpec)) {
        res.status(400).json({ error: 'platformSpec must be an object when provided' });
        return;
      }
    }

    const saveRequest: SaveProfileRequest = {
      id: body.id,
      displayName: body.displayName.trim(),
      description: body.description ?? '',
      framework: body.framework,
      version: body.version ?? '',
      platform: body.platform ?? '',
      platformSpec: body.platformSpec ?? null,
      workflowTemplateId: body.workflowTemplateId ?? null,
      remediateJtId: body.remediateJtId ?? null,
      eeId: body.eeId ?? null,
      remediationPlaybookPath: body.remediationPlaybookPath ?? '',
      scanTags: body.scanTags ?? '',
      certification: body.certification ?? null,
    };

    try {
      const profile = await database.saveProfile(saveRequest);
      res.status(201).json(profile);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save compliance profile: ${msg}`);
      res.status(500).json({ error: 'Failed to save compliance profile' });
    }
  });

  router.delete('/compliance-profiles/:id', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const { id } = req.params;
    try {
      const deleted = await database.deleteProfile(id);
      if (!deleted) {
        res.status(404).json({ error: 'Compliance profile not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete compliance profile: ${msg}`);
      res.status(500).json({ error: 'Failed to delete compliance profile' });
    }
  });

  // ─── Controller resource lookups (for compliance profile settings) ──

  router.get('/controller/job-templates', async (req, res) => {
    const userToken = getUserAapToken(req);
    try {
      const templates = await service.getJobTemplates(undefined, userToken);
      res.json(templates);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to list job templates: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve job templates from Controller' });
    }
  });

  router.get('/controller/workflow-job-templates', async (req, res) => {
    const userToken = getUserAapToken(req);
    try {
      const templates = await service.getWorkflowTemplates(undefined, userToken);
      res.json(templates);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to list workflow job templates: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve workflow templates from Controller' });
    }
  });

  router.get('/controller/execution-environments', async (req, res) => {
    const userToken = getUserAapToken(req);
    try {
      const ees = await service.getExecutionEnvironments(userToken);
      res.json(ees);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to list execution environments: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve execution environments from Controller' });
    }
  });

  return router;
}

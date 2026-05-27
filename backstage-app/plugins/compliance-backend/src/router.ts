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

import { ComplianceService } from './service/ComplianceService';
import { ComplianceDatabase } from './database/ComplianceDatabase';

import type {
  LaunchScanRequest,
  LaunchRemediationRequest,
  SaveRemediationProfileRequest,
  SaveCartridgeRequest,
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
  return typeof scanId === 'string' && scanId.length > 0 && scanId.length <= 128;
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
  router.use(express.json({ limit: '50mb' }));

  // ─── Health ─────────────────────────────────────────────────────────

  // Per-process override; defaults to config value or 90 days.
  let retentionDays = configRetentionDays ?? 90;

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
      res.status(500).json({ error: msg });
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
      const staleScans = scans.filter(
        s => (s.status === 'running' || s.status === 'pending') && s.workflowJobId,
      );
      await Promise.all(staleScans.map(async scan => {
        try {
          const isRemediation = scan.scanner === 'remediation';
          const status = isRemediation
            ? await service.getJobStatus(scan.workflowJobId!, userToken)
            : await service.getWorkflowJobStatus(scan.workflowJobId!, userToken);
          const terminal = ['successful', 'failed', 'error', 'canceled'];
          if (terminal.includes(status.status)) {
            const newStatus = status.status === 'successful' ? 'completed' : 'failed';
            await database.updateScanStatus(scan.id, newStatus, status.finished ?? new Date().toISOString());
            scan.status = newStatus as typeof scan.status;
            scan.completedAt = status.finished ?? new Date().toISOString();
          }
        } catch {
          // Controller unavailable — keep current scan status.
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
      const scan = await database.getScanById(scanId);
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
            await database.updateScanErrorDetails(scanId, details);
            scan.errorDetails = details;
          }
        } catch {
          // Best-effort: don't fail the GET if error fetch fails
        }
      }

      res.json(scan);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get scan ${scanId}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Workflow job templates ─────────────────────────────────────────

  router.get('/workflow-templates', async (req, res) => {
    const userToken = getUserAapToken(req);
    const nameFilter = req.query.name as string | undefined;
    const templates = await service.getWorkflowTemplates(nameFilter, userToken);
    res.json(templates);
  });

  // ─── Scan ───────────────────────────────────────────────────────────

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
      res.status(500).json({ error: msg });
    }
  });

  // ─── Findings ───────────────────────────────────────────────────────

  router.get('/findings', async (req, res) => {
    const scanId = req.query.scanId as string | undefined;
    const userToken = getUserAapToken(req);

    if (scanId && !isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    // 1. If a scanId is given, check the DB for stored findings first
    if (scanId) {
      const dbFindings = await database.getFindingsByScanId(scanId);
      if (dbFindings.length > 0) {
        res.json(await service.aggregateFindingsWithMetadata(dbFindings));
        return;
      }

      // 2. In live mode, resolve workflowJobId to DB scan and check for existing findings
      if (service.getDataSource() === 'live') {
        const workflowJobIdMatch = scanId.match(/^(?:scan-)?(\d+)$/);
        if (workflowJobIdMatch) {
          const workflowJobId = Number(workflowJobIdMatch[1]);
          const dbScan = await database.getScanByWorkflowJobId(workflowJobId);

          // Check if this scan already has findings in the DB
          if (dbScan) {
            const existingFindings = await database.getFindingsByScanId(dbScan.id);
            if (existingFindings.length > 0) {
              res.json(await service.aggregateFindingsWithMetadata(existingFindings));
              return;
            }
          }

          // No findings yet — check if workflow is complete and fetch
          try {
            const status = await service.getWorkflowJobStatus(workflowJobId, userToken);
            const st = status.status.toLowerCase();
            if (st === 'successful' || st === 'failed') {
              const dbScanId = dbScan?.id ?? scanId;

              logger.info(
                `Workflow ${workflowJobId} is complete — fetching and parsing results (dbScanId=${dbScanId})`,
              );
              const parsed = await service.fetchAndParseResults(
                workflowJobId,
                dbScanId,
                userToken,
              );

              if (dbScan) {
                await database.updateScanStatus(
                  dbScan.id,
                  parsed.length > 0 ? 'completed' : 'failed',
                  new Date().toISOString(),
                );
              }

              if (parsed.length > 0) {
                // Save a posture snapshot for trend tracking
                try {
                  const passCount = parsed.filter(f => f.status === 'pass').length;
                  const failCount = parsed.filter(f => f.status === 'fail').length;
                  const uniqueHosts = new Set(parsed.map(f => f.host)).size;
                  const uniqueRules = new Set(parsed.map(f => f.ruleId)).size;
                  const total = passCount + failCount;
                  await database.savePostureSnapshot({
                    profileId: dbScan?.profileId ?? scanId,
                    timestamp: new Date().toISOString(),
                    totalHosts: uniqueHosts,
                    totalRules: uniqueRules,
                    passCount,
                    failCount,
                    compliancePct: total > 0 ? Math.round((passCount / total) * 100) : 0,
                  });
                  logger.info(`Saved posture snapshot for profile=${dbScan?.profileId ?? scanId}`);
                } catch (snapshotError) {
                  logger.warn(`Failed to save posture snapshot: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`);
                }

                const freshFindings = await database.getFindingsByScanId(dbScanId);
                if (freshFindings.length > 0) {
                  res.json(await service.aggregateFindingsWithMetadata(freshFindings));
                  return;
                }
                res.json(await service.aggregateFindingsWithMetadata(parsed));
                return;
              }
            } else {
              logger.info(
                `Workflow ${workflowJobId} status is "${status.status}" — not yet ready to parse`,
              );
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`Failed to fetch/parse results for scan ${scanId}: ${msg}`);
          }
        }
      }
    }

    // 3. Fall through to the service (mock data or DB-based in live mode)
    const findings = await service.getFindings(scanId);
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
      res.status(500).json({ error: msg });
    }
  });

  // ─── Findings ingest (direct POST from playbook) ────────────────────

  router.post('/findings/ingest', async (req, res) => {
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
        raw as any,
        (raw.host as string) || 'unknown',
        scanId,
      ));

      const count = await database.saveFindingsForScan(scanId, mapped);

      // Extract per-rule metadata from the raw findings and persist
      // to the normalized rule_metadata table. This is the primary
      // source of title, description, fix_text, check_text for display.
      try {
        const ruleMap = new Map<string, Record<string, unknown>>();
        for (const raw of findings) {
          const ruleId = raw.rule_id as string;
          if (ruleId && !ruleMap.has(ruleId)) {
            ruleMap.set(ruleId, raw);
          }
        }
        const metadataRecords = Array.from(ruleMap.values()).map(raw => ({
          ruleId: raw.rule_id as string,
          stigId: (raw.stig_id as string) || '',
          title: (raw.title as string) || (raw.rule_id as string),
          description: (raw.description as string) || '',
          checkText: (raw.check_text as string) || '',
          fixText: (raw.fix_text as string) || '',
          category: (raw.category as string) || '',
          disruption: ((raw.disruption as string) || 'medium') as 'low' | 'medium' | 'high',
          scanner: (raw.scanner as string) || 'openscap',
          updatedAt: new Date().toISOString(),
        }));
        const metaCount = await database.upsertRuleMetadata(metadataRecords);
        logger.info(`Upserted ${metaCount} rule metadata records`);
      } catch (metaErr) {
        logger.warn(`Rule metadata upsert failed (non-fatal): ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
      }

      await database.updateScanStatus(scanId, 'completed', new Date().toISOString());

      // Save posture snapshot
      try {
        const passCount = mapped.filter(f => f.status === 'pass').length;
        const failCount = mapped.filter(f => f.status === 'fail').length;
        const uniqueHosts = new Set(mapped.map(f => f.host)).size;
        const uniqueRules = new Set(mapped.map(f => f.ruleId)).size;
        const total = passCount + failCount;
        await database.savePostureSnapshot({
          profileId: scan.profileId,
          timestamp: new Date().toISOString(),
          totalHosts: uniqueHosts,
          totalRules: uniqueRules,
          passCount,
          failCount,
          compliancePct: total > 0 ? Math.round((passCount / total) * 100) : 0,
        });
      } catch {
        // Posture snapshot is best-effort
      }

      logger.info(`Ingested ${count} findings for scan ${scanId} via direct POST`);
      res.status(201).json({ scanId, findingsCount: count });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to ingest findings: ${msg}`);
      res.status(500).json({ error: msg });
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
      const status = await service.getWorkflowJobStatus(jobId, userToken);
      res.json(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
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
      res.status(500).json({ error: msg });
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
      const nodes = await service.getWorkflowNodes(jobId, userToken);
      res.json(nodes);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
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
      res.status(500).json({ error: msg });
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
    if (enabledCount > 0) {
      const enabledRules = body.selections
        .filter((s: { enabled: boolean }) => s.enabled)
        .map((s: { ruleId: string }) => s.ruleId);
      logger.info(`Enabled rules: ${enabledRules.join(', ')}`);
    }

    try {
      // Fetch findings for the remediation plan. Try the provided scanId
      // first; if it returns nothing (e.g., old profile with non-numeric
      // scanId), fall back to the latest findings.
      let findings = await service.getFindings(body.scanId);
      if (findings.length === 0 && body.scanId) {
        logger.info(`No findings for scanId=${body.scanId}, falling back to latest`);
        findings = await service.getFindings();
      }
      logger.info(`Findings for remediation: ${findings.length} rules`);

      // Build the plan for the response (the service also builds it
      // internally for the actual launch, so the plan in the response
      // reflects what was actually executed).
      const plan = service.buildRemediationPlan(remediateRequest.selections, findings);
      logger.info(
        `Remediation plan: ${plan.groups.length} groups, ${plan.totalRules} rules, ${plan.totalHosts} hosts`,
      );

      const result = await service.launchRemediation(remediateRequest, findings, userToken);

      // Record the remediation as a scan-like event so it appears
      // in the active jobs banner and Recent Activity.
      await database.createScan({
        profileId: remediateRequest.profileId,
        inventoryId: remediateRequest.inventoryId,
        scanner: 'remediation',
        scanType: 'assessment',
        workflowJobId: result.workflowJobId,
        status: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
      });

      res.json({ ...result, plan });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to launch remediation: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Dashboard stats ───────────────────────────────────────────────

  router.get('/dashboard', async (_req, res) => {
    const stats = await service.getDashboardStats();
    res.json(stats);
  });

  // ─── Posture history ────────────────────────────────────────────────

  router.get('/posture', async (req, res) => {
    const profileId = req.query.profileId as string | undefined;
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const history = await service.getPostureHistory(profileId, days);
    res.json(history);
  });

  // ─── Remediations (saved rule selections) ──────────────────────────

  router.get('/remediation-profiles', async (_req, res) => {
    const profiles = await service.getRemediationProfiles();
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
      res.status(500).json({ error: msg });
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
      res.status(500).json({ error: msg });
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
      logger.error(`Failed to delete remediation profile: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Compliance profile registry ────────────────────────────────────

  router.get('/cartridges', async (_req, res) => {
    const cartridges = await database.listCartridges();

    // Enrich each cartridge with rule count from latest scan findings
    const enriched = await Promise.all(
      cartridges.map(async c => {
        const findings = await database.getLatestFindings(c.id);
        const uniqueRules = new Set(findings.map(f => f.ruleId)).size;
        return { ...c, ruleCount: uniqueRules };
      }),
    );

    res.json(enriched);
  });

  router.post('/cartridges', async (req, res) => {
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

    const saveRequest: SaveCartridgeRequest = {
      id: body.id,
      displayName: body.displayName.trim(),
      description: body.description ?? '',
      framework: body.framework,
      version: body.version ?? '',
      platform: body.platform ?? '',
      platformSpec: body.platformSpec ?? null,
      workflowTemplateId: body.workflowTemplateId ?? null,
      eeId: body.eeId ?? null,
      remediationPlaybookPath: body.remediationPlaybookPath ?? '',
      scanTags: body.scanTags ?? '',
    };

    try {
      const cartridge = await database.saveCartridge(saveRequest);
      res.status(201).json(cartridge);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save compliance profile: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  router.delete('/cartridges/:id', async (req, res) => {
    if (!await requirePermission(req, res, httpAuth, permissions)) return;

    const { id } = req.params;
    try {
      const deleted = await database.deleteCartridge(id);
      if (!deleted) {
        res.status(404).json({ error: 'Compliance profile not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete compliance profile: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Controller resource lookups (for compliance profile settings) ──

  router.get('/controller/workflow-job-templates', async (req, res) => {
    const userToken = getUserAapToken(req);
    try {
      const templates = await service.getWorkflowTemplates(undefined, userToken);
      res.json(templates);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/controller/execution-environments', async (req, res) => {
    const userToken = getUserAapToken(req);
    try {
      const ees = await service.getExecutionEnvironments(userToken);
      res.json(ees);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

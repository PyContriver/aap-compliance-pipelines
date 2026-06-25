import express from 'express';
import rateLimit from 'express-rate-limit';
import type { RouterDependencies } from './types';
import type { IngestFinding } from '@aap-compliance/common';
import { getUserAapToken } from './permissions';
import { isValidScanId, isValidProfileId } from './validation';
import { buildRuleMetadataRecords } from '../service/ComplianceService';
import { resolveScanId, savePostureFromFindings, fetchLiveFindings } from './helpers';

const ingestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many ingest requests, please try again later' },
});

export function registerFindingsRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, service, database, state } = deps;

  router.get('/findings', async (req, res) => {
    const scanId = req.query.scanId as string | undefined;
    const profileId = req.query.profileId as string | undefined;
    const stateFilter = req.query.state as string | undefined;
    const userToken = getUserAapToken(req);

    if (scanId && !isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }
    if (profileId && !isValidProfileId(profileId)) {
      res.status(400).json({ error: 'Invalid profileId' });
      return;
    }

    const validStates = new Set(['new', 'active', 'fixed', 'resurfaced']);
    const stateFilterSet = stateFilter
      ? new Set(stateFilter.split(',').filter(s => validStates.has(s)))
      : null;

    const { resolvedScanId, workflowJobId, dbScan } = await resolveScanId(database, scanId);

    let results: import('@aap-compliance/common').MultiHostFinding[] | null = null;

    const skipDbLookup = workflowJobId !== undefined && !dbScan;
    if (resolvedScanId && !skipDbLookup) {
      const dbFindings = await database.getFindingsByScanId(resolvedScanId);
      if (dbFindings.length > 0) {
        results = await service.aggregateFindingsWithMetadata(dbFindings);
      }
    }

    if (!results && resolvedScanId && service.getDataSource() === 'live' && workflowJobId) {
      try {
        const liveResult = await fetchLiveFindings(
          database, service, logger, state,
          resolvedScanId, workflowJobId, dbScan, userToken,
        );
        if (liveResult) {
          results = liveResult;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to fetch/parse results for scan ${resolvedScanId}: ${msg}`);
      }
    }

    if (!results) {
      results = await service.getFindings(resolvedScanId, profileId);
    }

    if (stateFilterSet && stateFilterSet.size > 0) {
      results = results.filter(f =>
        f.stateSummary && (
          (stateFilterSet.has('new') && f.stateSummary.new > 0) ||
          (stateFilterSet.has('active') && f.stateSummary.active > 0) ||
          (stateFilterSet.has('fixed') && f.stateSummary.fixed > 0) ||
          (stateFilterSet.has('resurfaced') && f.stateSummary.resurfaced > 0)
        ),
      );
    }

    res.json(results);
  });

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
      let currentScan = await database.getScanById(scanId);
      if (!currentScan && /^\d+$/.test(scanId)) {
        currentScan = await database.getScanByWorkflowJobId(Number(scanId));
      }

      if (!currentScan) {
        res.json([]);
        return;
      }

      const previousScan = await database.getPreviousScan(currentScan);
      if (!previousScan) {
        res.json([]);
        return;
      }

      const dbFindings = await database.getFindingsByScanId(previousScan.id);
      if (dbFindings.length > 0) {
        res.json(await service.aggregateFindingsWithMetadata(dbFindings));
        return;
      }

      const findings = await service.getFindings(previousScan.id);
      res.json(findings);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get previous findings: ${msg}`);
      res.status(500).json({ error: 'Failed to retrieve previous scan findings' });
    }
  });

  router.post('/findings/ingest', ingestLimiter, express.json({ limit: '50mb' }), async (req, res) => {
    const body = req.body;
    const scanId = body.scanId as string | undefined;
    const ingestToken = body.ingestToken as string | undefined;
    const findings = body.findings as Array<Record<string, unknown>> | undefined;
    const finalize = body.finalize === true;

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

      // Finalization: only run on the last per-host POST (finalize: true)
      // or when finalize is not specified (backward compat with single-POST)
      if (finalize || body.finalize === undefined) {
        await database.updateScanStatus(scanId, 'completed', new Date().toISOString());

        const allFindings = await database.getFindingsByScanId(scanId);
        const uniqueRules = new Set(allFindings.map(f => f.ruleId)).size;
        if (uniqueRules > 0) {
          await database.updateProfileRuleCount(scan.profileId, uniqueRules);
        }

        try {
          await savePostureFromFindings(database, logger, allFindings, scan.profileId, scan.inventoryId, scan.id);
        } catch (err) {
          logger.debug(`Posture snapshot failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          await database.computeFindingStates(scanId, scan.profileId, scan.inventoryId);
        } catch (err) {
          logger.warn(`Finding state computation failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      logger.info(`Ingested ${count} findings for scan ${scanId} via direct POST (finalize=${finalize})`);
      res.status(201).json({ scanId, findingsCount: count });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to ingest findings: ${msg}`);
      res.status(500).json({ error: 'Failed to ingest findings' });
    }
  });
}

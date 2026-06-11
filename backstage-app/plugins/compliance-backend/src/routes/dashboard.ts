import type express from 'express';
import type { RouterDependencies } from './types';
import { parseInventoryId } from './validation';

export function registerDashboardRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, service, database } = deps;

  router.get('/dashboard', async (_req, res) => {
    const stats = await service.getDashboardStats();
    res.json(stats);
  });

  // Temporary diagnostic — no auth required, same as /dashboard
  router.get('/dashboard/debug', async (_req, res) => {
    try {
      const scans = await database.getRecentScans(5);
      const profiles = await database.listProfiles();
      let latestPerInv: any[] = [];
      let latestError: string | null = null;
      try {
        latestPerInv = await database.getLatestScanPerProfileInventory();
      } catch (e) {
        latestError = e instanceof Error ? e.message : String(e);
      }
      res.json({
        scansCount: scans.length,
        scans: scans.map(s => ({ id: s.id.slice(0, 12), profileId: s.profileId.slice(0, 12), inventoryId: s.inventoryId, status: s.status, scanner: s.scanner, scanType: s.scanType })),
        profilesCount: profiles.length,
        profiles: profiles.map(p => ({ id: p.id.slice(0, 12), name: p.displayName })),
        latestPerInvCount: latestPerInv.length,
        latestPerInv: latestPerInv.map((s: any) => ({ id: s.id?.slice(0, 12), profileId: s.profileId?.slice(0, 12), inventoryId: s.inventoryId, status: s.status })),
        latestPerInvError: latestError,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
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

  router.get('/posture', async (req, res) => {
    const profileId = req.query.profileId as string | undefined;
    const inventoryId = parseInventoryId(req.query.inventoryId as string | undefined);
    if (req.query.inventoryId && inventoryId === undefined) {
      res.status(400).json({ error: 'inventoryId must be a positive integer' });
      return;
    }
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const history = await service.getPostureHistory(profileId, days, inventoryId);
    res.json(history);
  });

  router.get('/posture/events', async (req, res) => {
    const inventoryId = parseInventoryId(req.query.inventoryId as string | undefined);
    if (req.query.inventoryId && inventoryId === undefined) {
      res.status(400).json({ error: 'inventoryId must be a positive integer' });
      return;
    }
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 90));
    const events = await service.getRemediationEventsForTrend(days, inventoryId);
    res.json(events);
  });
}

import type express from 'express';
import type { RouterDependencies } from './types';

export function registerDashboardRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, service } = deps;

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

  router.get('/posture', async (req, res) => {
    const profileId = req.query.profileId as string | undefined;
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const history = await service.getPostureHistory(profileId, days);
    res.json(history);
  });
}

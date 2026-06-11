import type express from 'express';
import type { RouterDependencies } from './types';
import { isNonEmptyString } from './validation';

export function registerInventoryRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, service } = deps;

  router.get('/inventory/:inventoryId/host-posture', async (req, res) => {
    const inventoryId = Number(req.params.inventoryId);
    if (isNaN(inventoryId) || !Number.isInteger(inventoryId) || inventoryId < 1) {
      res.status(400).json({ error: 'inventoryId must be a positive integer' });
      return;
    }

    const profileId = req.query.profileId as string | undefined;
    if (!profileId || !isNonEmptyString(profileId)) {
      res.status(400).json({ error: 'profileId query parameter is required' });
      return;
    }

    try {
      const result = await service.getHostPosture(inventoryId, profileId, req);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get host posture for inventory ${inventoryId}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

}

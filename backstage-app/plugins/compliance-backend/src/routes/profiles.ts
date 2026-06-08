import type express from 'express';
import type { RouterDependencies } from './types';
import type { SaveProfileRequest } from '@aap-compliance/common';
import { requirePermission } from './permissions';
import { isNonEmptyString, isPositiveInteger } from './validation';

export function registerProfileRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, service, database, httpAuth, permissions } = deps;

  router.get('/compliance-profiles', async (_req, res) => {
    const profiles = await database.listProfiles();
    res.json(profiles);
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
      const ruleCount = service.getRuleCountForProfile(saveRequest.displayName, saveRequest.framework, saveRequest.version);
      const profile = await database.saveProfile(saveRequest, ruleCount);
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
}

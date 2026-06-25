import express from 'express';
import type { RouterDependencies } from './types';
import { isValidScanId } from './validation';

const ARTIFACT_KEY_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,254}$/;

function isValidArtifactKey(key: string): boolean {
  return ARTIFACT_KEY_RE.test(key) && !key.includes('..');
}

export function registerArtifactRoutes(
  router: express.Router,
  deps: RouterDependencies,
): void {
  const { logger, database } = deps;

  router.post('/scans/:scanId/artifacts', express.json({ limit: '1kb' }), async (req, res) => {
    const { scanId } = req.params;
    if (!isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    const { artifactKey, ociReference, artifactName, mimeType, ingestToken } = req.body;
    if (!artifactKey || !ociReference || !artifactName) {
      res.status(400).json({ error: 'Missing required fields: artifactKey, ociReference, artifactName' });
      return;
    }

    if (!isValidArtifactKey(artifactKey)) {
      res.status(400).json({ error: 'Invalid artifactKey format' });
      return;
    }

    const scan = await database.getScanById(scanId);
    if (!scan) {
      res.status(404).json({ error: `Scan ${scanId} not found` });
      return;
    }

    const storedToken = await database.getIngestToken(scanId);
    if (storedToken) {
      if (!ingestToken || storedToken !== ingestToken) {
        res.status(403).json({ error: 'Invalid or missing ingest token' });
        return;
      }
    }

    await database.storeArtifact(
      scanId,
      artifactKey,
      ociReference,
      artifactName,
      mimeType || 'application/json',
    );

    logger.info(`Artifact registered: ${artifactKey} for scan ${scanId}`);
    res.status(201).json({ artifactKey, scanId });
  });

  router.get('/scans/:scanId/artifacts', async (req, res) => {
    const { scanId } = req.params;
    if (!isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }

    const artifacts = await database.getArtifactsForScan(scanId);
    res.json(artifacts);
  });

  router.get('/scans/:scanId/artifacts/:key/download', async (req, res) => {
    const { scanId, key } = req.params;
    if (!isValidScanId(scanId)) {
      res.status(400).json({ error: 'Invalid scanId' });
      return;
    }
    if (!isValidArtifactKey(key)) {
      res.status(400).json({ error: 'Invalid artifact key format' });
      return;
    }

    const artifact = await database.getArtifact(scanId, key);
    if (!artifact) {
      res.status(404).json({ error: `Artifact ${key} not found for scan ${scanId}` });
      return;
    }

    try {
      const blob = await fetchOciBlob(artifact.ociReference, logger);
      res.set('Content-Type', artifact.mimeType);
      res.set('Content-Disposition', `attachment; filename="${artifact.artifactName}"`);
      res.send(Buffer.from(blob));
    } catch (err: any) {
      logger.error(`Failed to fetch artifact from PAH: ${err.message}`);
      res.status(502).json({ error: 'Failed to fetch artifact from registry' });
    }
  });
}

async function fetchOciBlob(
  ociReference: string,
  logger: any,
): Promise<ArrayBuffer> {
  const match = ociReference.match(/^([^/]+)\/(.+):(.+)$/);
  if (!match) throw new Error(`Invalid OCI reference: ${ociReference}`);

  const [, registry, repository, tag] = match;

  const { Agent } = await import('undici');
  const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });

  const baseUrl = `https://${registry}`;
  const manifestUrl = `${baseUrl}/v2/${repository}/manifests/${tag}`;
  logger.info(`Fetching OCI manifest: ${manifestUrl}`);

  const manifestResp = await fetch(manifestUrl, {
    headers: {
      Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.oras.artifact.manifest.v1+json',
    },
    dispatcher,
  } as any);

  if (!manifestResp.ok) {
    throw new Error(`Manifest fetch failed: ${manifestResp.status} ${manifestResp.statusText}`);
  }

  const manifest = await manifestResp.json() as any;
  const layers = manifest.layers || manifest.blobs || [];
  if (layers.length === 0) {
    throw new Error('No layers in OCI manifest');
  }

  const layer = layers[0];
  const blobUrl = `${baseUrl}/v2/${repository}/blobs/${layer.digest}`;
  logger.info(`Fetching OCI blob: ${blobUrl}`);

  const blobResp = await fetch(blobUrl, { dispatcher } as any);
  if (!blobResp.ok) {
    throw new Error(`Blob fetch failed: ${blobResp.status} ${blobResp.statusText}`);
  }

  return blobResp.arrayBuffer();
}

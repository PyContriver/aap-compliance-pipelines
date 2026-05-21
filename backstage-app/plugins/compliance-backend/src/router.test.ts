import http from 'http';
import express from 'express';
import { createRouter } from './router';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Minimal HTTP test helper (replaces supertest).
 * Creates a temporary server, sends a request, and returns the parsed response.
 */
async function testRequest(
  app: express.Express,
  options: {
    method?: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as { port: number };

  const url = `http://127.0.0.1:${addr.port}${options.path}`;
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: bodyStr,
  });

  let responseBody: unknown;
  const text = await response.text();
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );

  return { status: response.status, body: responseBody };
}

// ─── Mock factories ──────────────────────────────────────────────────

function createMockService() {
  return {
    getDataSource: jest.fn().mockReturnValue('mock'),
    getProfiles: jest.fn().mockResolvedValue([
      { id: 'rhel9-stig', name: 'DISA STIG RHEL 9', framework: 'DISA_STIG' },
    ]),
    getInventories: jest.fn().mockResolvedValue([
      { id: 1, name: 'test-inventory', hostCount: 3 },
    ]),
    getWorkflowTemplates: jest.fn().mockResolvedValue([
      { id: 10, name: 'compliance-scan', type: 'workflow_job_template' },
    ]),
    getExecutionEnvironments: jest.fn().mockResolvedValue([
      { id: 5, name: 'ee-supported-rhel9', image: 'registry.example.com/ee:latest' },
    ]),
    launchScan: jest.fn().mockResolvedValue({
      scanId: 'scan-1',
      workflowJobId: 42,
      status: 'pending',
    }),
    launchRemediation: jest.fn().mockResolvedValue({
      remediationId: 'rem-1',
      workflowJobId: 43,
      status: 'pending',
    }),
    getFindings: jest.fn().mockResolvedValue([]),
    getWorkflowJobStatus: jest.fn().mockResolvedValue({
      id: 42,
      status: 'pending',
      finished: null,
      failed: false,
      elapsed: 0,
      name: 'compliance-scan',
    }),
    getWorkflowNodes: jest.fn().mockResolvedValue([]),
    getJobEvents: jest.fn().mockResolvedValue([]),
    getDashboardStats: jest.fn().mockResolvedValue({
      hostsScanned: 0,
      criticalFindings: 0,
      pendingRemediation: 0,
      activeProfiles: 0,
      recentScans: [],
      frameworkScores: [],
    }),
    getPostureHistory: jest.fn().mockResolvedValue([]),
    getRemediationProfiles: jest.fn().mockResolvedValue([]),
    getRemediationProfile: jest.fn().mockResolvedValue(null),
    saveRemediationProfile: jest.fn().mockResolvedValue({ id: 'rp-1' }),
    deleteRemediationProfile: jest.fn().mockResolvedValue(true),
    buildRemediationPlan: jest
      .fn()
      .mockReturnValue({ groups: [], totalRules: 0, totalHosts: 0 }),
    fetchAndParseResults: jest.fn().mockResolvedValue([]),
    aggregateFindings: jest.fn().mockReturnValue([]),
  } as any;
}

function createMockDatabase() {
  return {
    createScan: jest.fn().mockResolvedValue({
      id: 'scan-1',
      profileId: 'rhel9-stig',
      inventoryId: 1,
      scanner: 'oscap',
      scanType: 'assessment',
      workflowJobId: 42,
      status: 'pending',
      startedAt: '2026-04-30T00:00:00.000Z',
      completedAt: null,
    }),
    getRecentScans: jest.fn().mockResolvedValue([
      {
        id: 'scan-1',
        profileId: 'rhel9-stig',
        inventoryId: 1,
        scanner: 'oscap',
        scanType: 'assessment',
        workflowJobId: 42,
        status: 'completed',
        startedAt: '2026-04-30T00:00:00.000Z',
        completedAt: '2026-04-30T00:05:00.000Z',
      },
    ]),
    getFindingsByScanId: jest.fn().mockResolvedValue([]),
    getScanByWorkflowJobId: jest.fn().mockResolvedValue(null),
    getPreviousScan: jest.fn().mockResolvedValue(null),
    listCartridges: jest.fn().mockResolvedValue([]),
    saveCartridge: jest.fn().mockResolvedValue({
      id: 'cart-1',
      displayName: 'RHEL 9 STIG',
      description: '',
      framework: 'DISA_STIG',
      version: 'V2R1',
      platform: 'RHEL 9',
      workflowTemplateId: null,
      eeId: null,
      remediationPlaybookPath: '',
      scanTags: '',
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    }),
    deleteCartridge: jest.fn().mockResolvedValue(true),
    getPostureSnapshots: jest.fn().mockResolvedValue([]),
    listRemediationProfiles: jest.fn().mockResolvedValue([]),
    getRemediationProfile: jest.fn().mockResolvedValue(null),
    saveRemediationProfile: jest.fn().mockResolvedValue({ id: 'rp-1' }),
    deleteRemediationProfile: jest.fn().mockResolvedValue(true),
  } as any;
}

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as any;

// ─── App setup ───────────────────────────────────────────────────────

async function createApp(
  serviceOverrides?: Partial<ReturnType<typeof createMockService>>,
  databaseOverrides?: Partial<ReturnType<typeof createMockDatabase>>,
) {
  const service = { ...createMockService(), ...serviceOverrides };
  const database = { ...createMockDatabase(), ...databaseOverrides };
  const router = await createRouter({
    logger: mockLogger,
    service,
    database,
  });
  const app = express();
  app.use(router);
  return { app, service, database };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('compliance backend router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── GET /health ──────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with status ok and dataSource', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, { path: '/health' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        dataSource: 'mock',
      });
    });

    it('reflects the actual data source', async () => {
      const { app } = await createApp({
        getDataSource: jest.fn().mockReturnValue('live'),
      });
      const res = await testRequest(app, { path: '/health' });

      expect(res.status).toBe(200);
      expect((res.body as any).dataSource).toBe('live');
    });
  });

  // ─── GET /profiles ────────────────────────────────────────────────

  describe('GET /profiles', () => {
    it('returns 200 with profiles array', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/profiles' });

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('rhel9-stig');
      expect(service.getProfiles).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when no profiles exist', async () => {
      const { app } = await createApp({
        getProfiles: jest.fn().mockResolvedValue([]),
      });
      const res = await testRequest(app, { path: '/profiles' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── GET /scans ───────────────────────────────────────────────────

  describe('GET /scans', () => {
    it('returns 200 with scans array from the database', async () => {
      const { app, database } = await createApp();
      const res = await testRequest(app, { path: '/scans' });

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].id).toBe('scan-1');
      expect(database.getRecentScans).toHaveBeenCalledWith(50);
    });
  });

  // ─── POST /scan ───────────────────────────────────────────────────

  describe('POST /scan', () => {
    it('returns 400 when profileId is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { inventoryId: 1 },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/profileId/);
    });

    it('returns 400 when profileId is empty string', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: '  ', inventoryId: 1 },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/profileId/);
    });

    it('returns 400 when inventoryId is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/inventoryId/);
    });

    it('returns 400 when inventoryId is not a positive integer', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig', inventoryId: -1 },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/inventoryId/);
    });

    it('returns 400 when inventoryId is a string', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig', inventoryId: 'abc' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/inventoryId/);
    });

    it('returns 400 when workflowTemplateId is invalid', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          workflowTemplateId: 'bad',
        },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/workflowTemplateId/);
    });

    it('returns 200 on valid input and persists scan', async () => {
      const { app, service, database } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig', inventoryId: 1 },
      });

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.scanId).toBe('scan-1');
      expect(body.workflowJobId).toBe(42);
      expect(body.status).toBe('pending');
      expect(service.launchScan).toHaveBeenCalledTimes(1);
      expect(database.createScan).toHaveBeenCalledTimes(1);
    });

    it('accepts optional workflowTemplateId', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          workflowTemplateId: 10,
        },
      });

      expect(res.status).toBe(200);
      expect(service.launchScan).toHaveBeenCalledWith(
        expect.objectContaining({ workflowTemplateId: 10 }),
        undefined,
      );
    });

    it('passes user AAP token from header', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig', inventoryId: 1 },
        headers: { 'x-aap-token': 'my-user-token' },
      });

      expect(res.status).toBe(200);
      expect(service.launchScan).toHaveBeenCalledWith(
        expect.any(Object),
        'my-user-token',
      );
    });

    it('returns 500 when service throws', async () => {
      const { app } = await createApp({
        launchScan: jest
          .fn()
          .mockRejectedValue(new Error('Controller unreachable')),
      });
      const res = await testRequest(app, {
        method: 'POST',
        path: '/scan',
        body: { profileId: 'rhel9-stig', inventoryId: 1 },
      });

      expect(res.status).toBe(500);
      expect((res.body as any).error).toBe('Controller unreachable');
    });
  });

  // ─── POST /cartridges ─────────────────────────────────────────────

  describe('POST /cartridges', () => {
    it('returns 400 when displayName is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/cartridges',
        body: { framework: 'DISA_STIG' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/displayName/);
    });

    it('returns 400 when framework is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/cartridges',
        body: { displayName: 'RHEL 9 STIG' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/framework/);
    });

    it('returns 400 when workflowTemplateId is invalid', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/cartridges',
        body: {
          displayName: 'RHEL 9 STIG',
          framework: 'DISA_STIG',
          workflowTemplateId: 'not-a-number',
        },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/workflowTemplateId/);
    });

    it('returns 201 on valid input', async () => {
      const { app, database } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/cartridges',
        body: {
          displayName: 'RHEL 9 STIG',
          framework: 'DISA_STIG',
          version: 'V2R1',
          platform: 'RHEL 9',
        },
      });

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.id).toBe('cart-1');
      expect(body.displayName).toBe('RHEL 9 STIG');
      expect(database.saveCartridge).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when database throws', async () => {
      const { app } = await createApp(undefined, {
        saveCartridge: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      const res = await testRequest(app, {
        method: 'POST',
        path: '/cartridges',
        body: {
          displayName: 'RHEL 9 STIG',
          framework: 'DISA_STIG',
        },
      });

      expect(res.status).toBe(500);
      expect((res.body as any).error).toBe('DB error');
    });
  });

  // ─── DELETE /cartridges/:id ───────────────────────────────────────

  describe('DELETE /cartridges/:id', () => {
    it('returns 204 on successful delete', async () => {
      const { app, database } = await createApp();
      const res = await testRequest(app, {
        method: 'DELETE',
        path: '/cartridges/cart-1',
      });

      expect(res.status).toBe(204);
      expect(database.deleteCartridge).toHaveBeenCalledWith('cart-1');
    });

    it('returns 404 when cartridge not found', async () => {
      const { app } = await createApp(undefined, {
        deleteCartridge: jest.fn().mockResolvedValue(false),
      });
      const res = await testRequest(app, {
        method: 'DELETE',
        path: '/cartridges/nonexistent',
      });

      expect(res.status).toBe(404);
      expect((res.body as any).error).toMatch(/not found/i);
    });

    it('returns 500 when database throws', async () => {
      const { app } = await createApp(undefined, {
        deleteCartridge: jest.fn().mockRejectedValue(new Error('DB error')),
      });
      const res = await testRequest(app, {
        method: 'DELETE',
        path: '/cartridges/cart-1',
      });

      expect(res.status).toBe(500);
      expect((res.body as any).error).toBe('DB error');
    });
  });

  // ─── GET /posture ─────────────────────────────────────────────────

  describe('GET /posture', () => {
    it('returns 200 with posture history', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/posture' });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(
        undefined,
        30, // default days
      );
    });

    it('passes profileId query parameter', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        path: '/posture?profileId=rhel9-stig',
      });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(
        'rhel9-stig',
        30,
      );
    });

    it('clamps days parameter to minimum of 1', async () => {
      const { app, service } = await createApp();
      // Number('0.5') is 0.5, which is truthy, so || 30 does not trigger.
      // Math.max(1, 0.5) = 1
      const res = await testRequest(app, { path: '/posture?days=0.5' });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(undefined, 1);
    });

    it('treats days=0 as default (30) because 0 is falsy', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/posture?days=0' });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(undefined, 30);
    });

    it('clamps days parameter to maximum of 365', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/posture?days=999' });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(undefined, 365);
    });

    it('defaults days to 30 when not a valid number', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/posture?days=abc' });

      expect(res.status).toBe(200);
      expect(service.getPostureHistory).toHaveBeenCalledWith(undefined, 30);
    });
  });

  // ─── GET /dashboard ───────────────────────────────────────────────

  describe('GET /dashboard', () => {
    it('returns 200 with dashboard stats', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/dashboard' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        hostsScanned: 0,
        criticalFindings: 0,
        pendingRemediation: 0,
        activeProfiles: 0,
        recentScans: [],
        frameworkScores: [],
      });
      expect(service.getDashboardStats).toHaveBeenCalledTimes(1);
    });
  });

  // ─── GET /inventories ─────────────────────────────────────────────

  describe('GET /inventories', () => {
    it('returns 200 with inventories array', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/inventories' });

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('test-inventory');
      expect(service.getInventories).toHaveBeenCalledWith(undefined);
    });

    it('passes user AAP token', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        path: '/inventories',
        headers: { 'x-aap-token': 'user-tok' },
      });

      expect(res.status).toBe(200);
      expect(service.getInventories).toHaveBeenCalledWith('user-tok');
    });
  });

  // ─── GET /workflow-status/:jobId ──────────────────────────────────

  describe('GET /workflow-status/:jobId', () => {
    it('returns 400 for non-numeric jobId', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        path: '/workflow-status/abc',
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/jobId must be a number/);
    });

    it('returns 200 with status for valid jobId', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        path: '/workflow-status/42',
      });

      expect(res.status).toBe(200);
      expect((res.body as any).id).toBe(42);
      expect(service.getWorkflowJobStatus).toHaveBeenCalledWith(
        42,
        undefined,
      );
    });

    it('returns 500 when service throws', async () => {
      const { app } = await createApp({
        getWorkflowJobStatus: jest
          .fn()
          .mockRejectedValue(new Error('Not found')),
      });
      const res = await testRequest(app, {
        path: '/workflow-status/999',
      });

      expect(res.status).toBe(500);
      expect((res.body as any).error).toBe('Not found');
    });
  });

  // ─── POST /remediate ──────────────────────────────────────────────

  describe('POST /remediate', () => {
    it('returns 400 when profileId is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: { inventoryId: 1, selections: [] },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/profileId/);
    });

    it('returns 400 when inventoryId is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: { profileId: 'rhel9-stig', selections: [] },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/inventoryId/);
    });

    it('returns 400 when selections is not an array', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          selections: 'not-array',
        },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/selections/);
    });

    it('returns 400 when a selection is missing ruleId', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          selections: [{ enabled: true }],
        },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/selections\[0\]\.ruleId/);
    });

    it('returns 400 when a selection is missing enabled', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          selections: [{ ruleId: 'rule-1' }],
        },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/selections\[0\]\.enabled/);
    });

    it('returns 200 on valid remediation request', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediate',
        body: {
          profileId: 'rhel9-stig',
          inventoryId: 1,
          selections: [{ ruleId: 'rule-1', enabled: true }],
        },
      });

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.remediationId).toBe('rem-1');
      expect(body.plan).toBeDefined();
      expect(service.launchRemediation).toHaveBeenCalledTimes(1);
      expect(service.buildRemediationPlan).toHaveBeenCalledTimes(1);
    });
  });

  // ─── POST /remediation-profiles ───────────────────────────────────

  describe('POST /remediation-profiles', () => {
    it('returns 400 when name is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediation-profiles',
        body: { selections: [] },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/name/);
    });

    it('returns 400 when selections is missing', async () => {
      const { app } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediation-profiles',
        body: { name: 'my-profile' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toMatch(/selections/);
    });

    it('returns 201 on valid input', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        method: 'POST',
        path: '/remediation-profiles',
        body: {
          name: 'my-profile',
          selections: [{ ruleId: 'r1', enabled: true }],
        },
      });

      expect(res.status).toBe(201);
      expect(service.saveRemediationProfile).toHaveBeenCalledTimes(1);
    });
  });

  // ─── GET /findings ────────────────────────────────────────────────

  describe('GET /findings', () => {
    it('returns findings from service when no scanId given', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, { path: '/findings' });

      expect(res.status).toBe(200);
      expect(service.getFindings).toHaveBeenCalledWith(undefined);
    });

    it('returns DB findings when scanId matches stored data', async () => {
      const storedFindings = [
        {
          id: 'f-1',
          scanId: 'scan-1',
          ruleId: 'rule-1',
          stigId: 'RHEL-09-001',
          host: 'host1',
          status: 'fail',
          severity: 'high',
          actualValue: 'off',
          expectedValue: 'on',
          evidence: null,
        },
      ];
      const aggregated = [{ ruleId: 'rule-1', hosts: [{ host: 'host1', status: 'fail' }] }];
      const { app, database, service } = await createApp(
        { aggregateFindings: jest.fn().mockReturnValue(aggregated) },
        { getFindingsByScanId: jest.fn().mockResolvedValue(storedFindings) },
      );
      const res = await testRequest(app, {
        path: '/findings?scanId=scan-1',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(aggregated);
      expect(database.getFindingsByScanId).toHaveBeenCalledWith('scan-1');
      expect(service.aggregateFindings).toHaveBeenCalledWith(storedFindings);
      expect(service.getFindings).not.toHaveBeenCalled();
    });
  });

  // ─── GET /cartridges ──────────────────────────────────────────────

  describe('GET /cartridges', () => {
    it('returns 200 with cartridges from database', async () => {
      const { app, database } = await createApp();
      const res = await testRequest(app, { path: '/cartridges' });

      expect(res.status).toBe(200);
      expect(database.listCartridges).toHaveBeenCalledTimes(1);
    });
  });

  // ─── GET /workflow-templates ──────────────────────────────────────

  describe('GET /workflow-templates', () => {
    it('returns workflow templates', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        path: '/workflow-templates',
      });

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(service.getWorkflowTemplates).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it('passes name filter query parameter', async () => {
      const { app, service } = await createApp();
      const res = await testRequest(app, {
        path: '/workflow-templates?name=compliance',
      });

      expect(res.status).toBe(200);
      expect(service.getWorkflowTemplates).toHaveBeenCalledWith(
        'compliance',
        undefined,
      );
    });
  });
});

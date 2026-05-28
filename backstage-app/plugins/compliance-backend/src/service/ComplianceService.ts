/**
 * Core compliance service — the single entry point for all compliance operations.
 *
 * Checks `compliance.dataSource` in app-config.yaml:
 * - 'mock' (default) → returns mock data, no AAP connection needed
 * - 'live'           → calls Controller API via ControllerClient
 */
import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

import type {
  ComplianceProfile,
  MultiHostFinding,
  StoredFinding,
  DashboardStats,
  LaunchScanRequest,
  LaunchScanResponse,
  LaunchRemediationRequest,
  LaunchRemediationResponse,
  PostureSnapshot,
  RemediationProfile,
  SaveRemediationProfileRequest,
  WorkflowJobStatus,
  WorkflowNode,
  JobEvent,
  RemediationSelection,
  RemediationPlan,
  RemediationPlanGroup,
} from '@aap-compliance/common';

import { ControllerClient } from './ControllerClient';
import { ComplianceDatabase } from '../database/ComplianceDatabase';
import { MockDataProvider } from './MockDataProvider';

// ─── Severity mapping (Track A uses lowercase, stored as CAT_*) ──────

const SEVERITY_MAP: Record<string, string> = {
  high: 'CAT_I',
  medium: 'CAT_II',
  low: 'CAT_III',
};

interface RuleMetadata {
  title: string;
  description: string;
  check_text: string;
  fix_text: string;
  category: string;
  disruption: string;
  parameters: Array<{
    name: string;
    label: string;
    type: string;
    default: unknown;
    options?: Array<{ value: unknown; label: string }>;
  }>;
}

function loadRulesMetadata(): Map<string, RuleMetadata> {
  const map = new Map<string, RuleMetadata>();
  // Check package-root rules/ first (dist-dynamic: __dirname is dist/service/,
  // so ../../rules/ reaches package root), then collections path (local dev)
  const packageRules = path.resolve(__dirname, '..', '..', 'rules');
  const collectionsRules = path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'collections', 'ansible_collections', 'security', 'compliance_rhel9_stig', 'rules',
  );
  const rulesDir = fs.existsSync(packageRules) ? packageRules : collectionsRules;
  try {
    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    for (const file of files) {
      const content = yaml.parse(fs.readFileSync(path.join(rulesDir, file), 'utf-8'));
      for (const rule of content?.rules ?? []) {
        map.set(rule.id, {
          title: rule.title ?? rule.id,
          description: rule.description ?? '',
          check_text: rule.check_text ?? '',
          fix_text: rule.fix_text ?? '',
          category: rule.category ?? '',
          disruption: rule.disruption ?? 'low',
          parameters: (rule.parameters ?? []).map((p: Record<string, unknown>) => ({
            name: p.name as string,
            label: (p.label as string) ?? (p.name as string),
            type: (p.type as string) ?? 'text',
            default: p.default ?? '',
            options: p.options as Array<{ value: unknown; label: string }> | undefined,
          })),
        });
      }
    }
  } catch (err) {
    // Rules files not found — enrichment will be skipped.
    // This is expected when running without the collections directory.
    // Rules files not available — this is expected in dev/mock mode.
    // The logger is not accessible in this static helper; the caller
    // logs the loaded count instead.
  }
  return map;
}

/**
 * Shape of a single finding from the normalize_xccdf module output (Track B)
 * or the legacy compliance_evaluate module (deprecated, replaced by OpenSCAP
 * scanning -- see ADR-004). Findings are delivered via Direct POST to
 * /findings/ingest (ADR-007); event parsing is the fallback.
 */
interface RawControllerFinding {
  rule_id: string;
  stig_id?: string;
  title?: string;
  severity?: string;
  status: string;
  host?: string;
  evidence?: string | Record<string, unknown>;
  actual_value?: string;
  expected_value?: string;
  category?: string;
  check_type?: string;
  fix_text?: string;
  check_text?: string;
  disruption?: string;
  parameters?: unknown[];
}

export type DataSource = 'mock' | 'live';

export class ComplianceService {
  private readonly dataSource: DataSource;
  private readonly controllerClient: ControllerClient | null;
  private readonly logger: LoggerService;
  private readonly config: Config;
  private database: ComplianceDatabase | null = null;
  private rulesMetadata: Map<string, RuleMetadata> | null = null;

  constructor(config: Config, logger: LoggerService) {
    this.config = config;
    this.logger = logger;

    // Read the toggle flag — default to 'mock' for safe demos
    const rawSource = config.getOptionalString('compliance.dataSource') ?? 'mock';
    this.dataSource = rawSource === 'live' ? 'live' : 'mock';

    this.logger.info(
      `ComplianceService initialized with dataSource=${this.dataSource}`,
    );

    // Only construct the Controller client when in live mode
    if (this.dataSource === 'live') {
      const ansibleConfig = config.getOptionalConfig('ansible');
      const baseUrl = ansibleConfig?.getOptionalString('rhaap.baseUrl') ?? '';
      const token = ansibleConfig?.getOptionalString('rhaap.token') ?? '';
      const checkSSL = ansibleConfig?.getOptionalBoolean('rhaap.checkSSL') ?? true;

      if (!baseUrl || !token) {
        throw new Error(
          'compliance.dataSource is "live" but ansible.rhaap.baseUrl / ansible.rhaap.token are not configured',
        );
      }

      this.controllerClient = new ControllerClient(
        { baseUrl, token, checkSSL },
        logger,
      );
    } else {
      this.controllerClient = null;
    }
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  /**
   * Inject the database reference after construction.
   * Called from plugin.ts — avoids a circular constructor dependency.
   */
  setDatabase(db: ComplianceDatabase): void {
    this.database = db;
  }

  private getRulesMetadata(): Map<string, RuleMetadata> {
    if (!this.rulesMetadata) {
      this.rulesMetadata = loadRulesMetadata();
      this.logger.info(`Loaded ${this.rulesMetadata.size} rule metadata entries`);
    }
    return this.rulesMetadata;
  }

  // ─── Profiles ───────────────────────────────────────────────────────

  async getProfiles(): Promise<ComplianceProfile[]> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getProfiles();
    }
    return [];
  }

  // ─── Inventories ────────────────────────────────────────────────────

  async getInventories(token?: string): Promise<Array<{ id: number; name: string; hostCount: number }>> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getInventories().map(inv => ({
        id: inv.id,
        name: inv.name,
        hostCount: inv.total_hosts,
      }));
    }

    const result = await this.controllerClient!.listInventories(token);
    return result.results.map(inv => ({
      id: inv.id,
      name: inv.name,
      hostCount: inv.total_hosts,
    }));
  }

  async getInventoryHostFacts(
    inventoryId: number,
    token?: string,
  ): Promise<Array<{ hostname: string; ansible_os_family?: string; ansible_distribution_major_version?: string; device_type?: string }>> {
    if (this.dataSource === 'mock') {
      return [];
    }
    return this.controllerClient!.getInventoryHostFacts(inventoryId, token);
  }

  // ─── Workflow job templates ─────────────────────────────────────────

  async getWorkflowTemplates(
    nameFilter?: string,
    token?: string,
  ): Promise<Array<{ id: number; name: string; description: string }>> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getWorkflowTemplates(nameFilter);
    }

    const result = await this.controllerClient!.listWorkflowJobTemplates(nameFilter, token);
    return result.results;
  }

  // ─── Execution environments ─────────────────────────────────────────

  async getExecutionEnvironments(token?: string): Promise<Array<{ id: number; name: string; image: string }>> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getExecutionEnvironments();
    }

    const result = await this.controllerClient!.listExecutionEnvironments(token);
    return result.results;
  }

  // ─── Scan ───────────────────────────────────────────────────────────

  async launchScan(request: LaunchScanRequest, token?: string, scanId?: string, ingestToken?: string): Promise<LaunchScanResponse> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.launchScan(request.profileId);
    }

    // ── Resolve the workflow template ID ──────────────────────────────
    const resolvedTemplateId = await this.resolveWorkflowTemplateId(
      request.profileId,
      request.workflowTemplateId,
      token,
    );

    // ── Build extra_vars for the workflow launch ─────────────────────
    // backstage_api_url and scan_id enable the playbook to POST findings
    // directly to the plugin API after normalization (Direct POST pattern).
    const backstageUrl = this.config?.getOptionalString('backend.baseUrl') || '';
    const extraVars: Record<string, unknown> = {
      compliance_profile: request.profileId,
      evaluate_only: request.evaluateOnly,
      inventory_id: request.inventoryId,
      backstage_api_url: backstageUrl,
      scan_id: scanId || '',
      ingest_token: ingestToken || '',
      _gather_facts: request.gatherFacts || false,
    };

    // ── Launch the workflow ──────────────────────────────────────────
    this.logger.info(
      `Launching workflow template ${resolvedTemplateId} for profile=${request.profileId} inventory=${request.inventoryId}` +
      (request.limit ? ` limit=${request.limit}` : ''),
    );

    const launch = await this.controllerClient!.launchWorkflow(
      resolvedTemplateId,
      extraVars,
      token,
      request.limit,
      undefined,
      request.inventoryId,
    );

    const workflowJobId = launch.workflow_job ?? launch.id;

    this.logger.info(
      `Workflow job ${workflowJobId} launched (status=${launch.status})`,
    );

    return {
      scanId: `scan-${workflowJobId}`,
      workflowJobId,
      status: launch.status,
    };
  }

  /**
   * Resolve the workflow job template ID to use for a scan.
   *
   * Resolution order:
   *   1. Explicit `workflowTemplateId` from the scan request (user override)
   *   2. Cartridge registry in the database (mapped per compliance profile)
   *   3. Name-based search on the Controller (fallback for unconfigured profiles)
   */
  private async resolveWorkflowTemplateId(
    profileId: string,
    requestTemplateId?: number,
    token?: string,
  ): Promise<number> {
    // (1) Explicit from request — highest priority
    if (requestTemplateId) {
      this.logger.info(
        `Using workflow template ${requestTemplateId} from scan request`,
      );
      return requestTemplateId;
    }

    // (2) Look up the cartridge in the DB
    if (this.database) {
      const cartridge = await this.database.getCartridge(profileId);
      if (cartridge?.workflowTemplateId) {
        this.logger.info(
          `Using workflow template ${cartridge.workflowTemplateId} from cartridge registry (profile=${profileId})`,
        );
        return cartridge.workflowTemplateId;
      }
    }

    // (3) Name-based search on the Controller
    this.logger.info(
      `No workflow template configured for profile=${profileId} — searching Controller by name`,
    );
    const templates = await this.controllerClient!.listWorkflowJobTemplates('compliance', token);
    const template = templates.results.find(t =>
      t.name.toLowerCase().includes(profileId.replace(/-/g, '_')),
    ) ?? templates.results[0];

    if (!template) {
      throw new Error(
        `No compliance workflow job template found for profile ${profileId}. ` +
        `Register one in the cartridge registry or provide workflowTemplateId in the scan request.`,
      );
    }

    this.logger.info(
      `Resolved workflow template ${template.id} ("${template.name}") by name search`,
    );
    return template.id;
  }

  /**
   * Resolve the remediate job template ID.
   *
   * Looks up the workflow template from the cartridge registry, finds
   * the remediate node within it, and returns that node's JT ID.
   * Falls back to searching for a JT named "compliance-remediate".
   */
  private async resolveRemediateJobTemplateId(
    profileId: string,
    token?: string,
  ): Promise<number> {
    // The remediate JT is a standalone job template, not part of the
    // assessment workflow (which is gather → evaluate only). Resolution
    // order: (1) name-based search on Controller, (2) cartridge registry.
    const result = await this.controllerClient!.listJobTemplates('compliance-remediate', token);
    if (result.results.length > 0) {
      this.logger.info(`Resolved remediate JT ${result.results[0].id} via name search`);
      return result.results[0].id;
    }

    throw new Error('No compliance remediate job template found. Ensure a JT named "compliance-remediate" exists.');
  }

  // ─── Remediation ────────────────────────────────────────────────────

  async launchRemediation(
    request: LaunchRemediationRequest,
    findings: MultiHostFinding[],
    token?: string,
  ): Promise<LaunchRemediationResponse> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.launchRemediation();
    }

    // Build the optimized remediation plan from selections + findings
    const plan = this.buildRemediationPlan(request.selections, findings);

    // Collect rule IDs (tags) and host limits from the plan groups.
    let allTags = plan.groups.flatMap(g => g.tags);
    const allHosts = new Set<string>();
    const mergedExtraVars: Record<string, unknown> = {};
    for (const group of plan.groups) {
      group.limit.split(',').filter(Boolean).forEach(h => allHosts.add(h));
      Object.assign(mergedExtraVars, group.extraVars);
    }

    // If plan produced 0 groups (e.g., all selected rules already pass),
    // use the selected rule IDs as tags directly and target all hosts.
    if (allTags.length === 0) {
      const enabledRuleIds = request.selections
        .filter(s => s.enabled)
        .map(s => s.ruleId);
      if (enabledRuleIds.length > 0) {
        allTags = enabledRuleIds;
        for (const f of findings) {
          f.hosts.forEach(h => allHosts.add(h.host));
        }
        this.logger.info(
          `Plan produced 0 groups — using ${enabledRuleIds.length} selected rule IDs as tags directly`,
        );
      }
    }

    const limit = allHosts.size > 0
      ? Array.from(allHosts).join(',')
      : request.limit;

    const jobTags = allTags.length > 0 ? allTags.join(',') : undefined;

    // Launch the remediate JT directly with native job_tags.
    // This is the proper AAP pattern: the CaC playbook's tasks are tagged
    // per rule ID, and the Controller applies --tags at the CLI level.
    // No wrapper or subprocess needed.
    //
    // We don't use the workflow for remediation because workflow-level
    // job_tags don't propagate to child JTs in AAP. Direct JT launch
    // is the correct mechanism for scoped remediation.
    const resolvedJtId = await this.resolveRemediateJobTemplateId(
      request.profileId,
      token,
    );

    this.logger.info(
      `Launching remediate JT ${resolvedJtId} for profile=${request.profileId}` +
      ` (${allTags.length} rules, ${allHosts.size} hosts)` +
      (limit ? ` limit=${limit}` : '') +
      (jobTags ? ` job_tags=${jobTags}` : ''),
    );

    const launch = await this.controllerClient!.launchJobTemplate(
      resolvedJtId,
      mergedExtraVars,
      token,
      limit,
      jobTags,
    );

    const workflowJobId = launch.id;

    return {
      remediationId: `remediation-${workflowJobId}`,
      workflowJobId,
      status: launch.status,
    };
  }

  // ─── Findings ───────────────────────────────────────────────────────

  async getFindings(scanId?: string): Promise<MultiHostFinding[]> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getFindings();
    }

    if (!scanId) {
      if (this.database) {
        const latest = await this.database.getLatestFindings();
        if (latest.length > 0) return this.storedFindingsToMultiHost(latest);
      }
      return [];
    }

    if (this.database) {
      const dbFindings = await this.database.getFindingsByScanId(scanId);
      if (dbFindings.length > 0) {
        return this.storedFindingsToMultiHost(dbFindings);
      }
    }

    return [];
  }

  // ─── Scan result fetching & parsing ────────────────────────────────

  /**
   * Fetch scan results from the Controller API, parse them, and persist
   * to the database.
   *
   * Called when a scan job completes and Direct POST findings are not
   * available. Falls back to parsing job events from the normalize node.
   * Supports Track B (normalize_xccdf output) and legacy Track A
   * (compliance_evaluate module, deprecated -- see ADR-004).
   *
   * Returns the parsed StoredFinding[] (without the id field -- the DB
   * generates IDs on insert).
   */
  async fetchAndParseResults(
    workflowJobId: number,
    scanId: string,
    token?: string,
  ): Promise<Array<Omit<StoredFinding, 'id'>>> {
    if (!this.controllerClient) {
      throw new Error('Cannot fetch results in mock mode — no Controller client');
    }

    // Check if findings were already saved by Direct POST from the playbook.
    // If so, skip event parsing entirely — the data is already in the DB.
    if (this.database) {
      const existing = await this.database.getFindingsByScanId(scanId);
      if (existing.length > 0) {
        this.logger.info(
          `Found ${existing.length} findings already in DB for scan ${scanId} (via Direct POST). Skipping event parsing.`,
        );
        return existing;
      }
    }

    this.logger.info(
      `Fetching results for workflow job ${workflowJobId} (scan ${scanId}) via event parsing (fallback)`,
    );

    // Step 1: Get workflow nodes to find the normalize job
    const nodesResponse = await this.controllerClient.getWorkflowNodes(
      workflowJobId,
      token,
    );
    const nodes = nodesResponse.results;

    // Find the node that produces findings. With the oscap pipeline this is
    // run-oscap (single node that scans + normalizes). Fall back to normalize
    // or evaluate for backward compatibility with older workflow layouts.
    const normalizeNode = nodes.find(
      n =>
        n.identifier?.toLowerCase().includes('run-oscap') ||
        n.summary_fields?.job?.name?.toLowerCase().includes('run-oscap') ||
        n.identifier?.toLowerCase().includes('normaliz') ||
        n.summary_fields?.job?.name?.toLowerCase().includes('normaliz') ||
        n.identifier?.toLowerCase().includes('evaluat') ||
        n.summary_fields?.job?.name?.toLowerCase().includes('evaluat'),
    );

    if (!normalizeNode?.summary_fields?.job?.id) {
      this.logger.warn(
        `No normalize/evaluate node found in workflow ${workflowJobId}. ` +
        `Nodes: ${nodes.map(n => `${n.identifier}(${n.summary_fields?.job?.name ?? 'no-job'})`).join(', ')}`,
      );
      return [];
    }

    const normalizeJobId = normalizeNode.summary_fields.job.id;
    this.logger.info(
      `Found normalize job ${normalizeJobId} (node: ${normalizeNode.identifier})`,
    );

    // Step 2: Fetch runner_on_ok events from the normalize job
    const eventsResponse = await this.controllerClient.getRunnerOkEvents(
      normalizeJobId,
      token,
    );
    const events = eventsResponse.results;
    this.logger.info(
      `Retrieved ${events.length} runner_on_ok events from normalize job ${normalizeJobId}`,
    );

    // Step 3: Parse findings from job events
    const findings = this.parseJobEvents(events, scanId);
    this.logger.info(
      `Parsed ${findings.length} findings from normalize job ${normalizeJobId}`,
    );

    // Step 4: Try to persist to the database (non-fatal if it fails)
    if (this.database && findings.length > 0) {
      try {
        await this.database.saveFindingsForScan(scanId, findings);
        await this.database.updateScanStatus(
          scanId,
          'completed',
          new Date().toISOString(),
        );
        this.logger.info(
          `Persisted ${findings.length} findings for scan ${scanId}`,
        );
      } catch (persistError) {
        this.logger.warn(
          `Could not persist findings to DB (scan ${scanId}): ${persistError instanceof Error ? persistError.message : String(persistError)}`,
        );
      }
    }

    return findings;
  }

  /**
   * Parse job events from the normalize job into StoredFinding rows.
   *
   * This is the fallback path -- findings are normally delivered via
   * Direct POST (ADR-007). Supports two tracks:
   *   - Track B: normalize_xccdf output surfaced through ansible_facts
   *   - Track A (legacy): compliance_evaluate module output (deprecated,
   *     replaced by OpenSCAP scanning -- see ADR-004)
   *
   * In both cases, the per-host findings appear in event_data.res.findings
   * or event_data.res.ansible_facts.findings.
   */
  private parseJobEvents(
    events: JobEvent[],
    scanId: string,
  ): Array<Omit<StoredFinding, 'id'>> {
    const findings: Array<Omit<StoredFinding, 'id'>> = [];

    for (const event of events) {
      const eventData = event.event_data as Record<string, unknown>;
      const res = eventData?.res as Record<string, unknown> | undefined;
      if (!res) continue;

      // Determine the host — from event_data.host, event.host_name, or
      // the module's own 'host' return value
      const host =
        (eventData.host as string) ||
        event.host_name ||
        (res.host as string) ||
        'unknown';

      // Look for findings in multiple locations:
      // 1. res.findings (direct module output -- legacy compliance_evaluate, deprecated)
      // 2. res.ansible_facts.findings (facts-based output)
      // 3. res.ansible_facts.compliance_results.findings (nested facts)
      // 4. res.ansible_facts.compliance_report.findings (consolidated report)
      const factsSource =
        (res.ansible_facts as Record<string, unknown>) ?? {};

      const rawFindings: RawControllerFinding[] | undefined =
        (res.findings as RawControllerFinding[]) ??
        (factsSource.findings as RawControllerFinding[]) ??
        ((factsSource.compliance_results as Record<string, unknown>)
          ?.findings as RawControllerFinding[] | undefined) ??
        ((factsSource.compliance_report as Record<string, unknown>)
          ?.findings as RawControllerFinding[] | undefined);

      if (rawFindings && Array.isArray(rawFindings)) {
        for (const raw of rawFindings) {
          // Track A findings carry a host field; Track B may have per-host
          const findingHost = raw.host || host;
          findings.push(this.mapRawFinding(raw, findingHost, scanId));
        }
      }
    }

    return findings;
  }

  /**
   * Map a single raw finding from the Ansible module output to our
   * StoredFinding format.
   */
  mapRawFindingPublic(
    raw: RawControllerFinding,
    host: string,
    scanId: string,
  ): Omit<StoredFinding, 'id'> {
    return this.mapRawFinding(raw, host, scanId);
  }

  private mapRawFinding(
    raw: RawControllerFinding,
    host: string,
    scanId: string,
  ): Omit<StoredFinding, 'id'> {
    // Map severity: the module uses lowercase (high/medium/low),
    // but the XCCDF normalizer already maps to CAT_I/II/III.
    // Handle both cases.
    let severity = raw.severity ?? 'medium';
    if (!severity.startsWith('CAT_')) {
      severity = SEVERITY_MAP[severity.toLowerCase()] ?? 'CAT_II';
    }

    // Evidence can be a string or a structured object
    let evidence: string | null = null;
    if (typeof raw.evidence === 'string') {
      evidence = raw.evidence;
    } else if (raw.evidence && typeof raw.evidence === 'object') {
      evidence = JSON.stringify(raw.evidence);
    }

    // Extract actual/expected values from explicit fields or parse from evidence string.
    // Evidence format: "sshd_config clientaliveinterval: <actual> (expected: <expected>)"
    let actualValue = raw.actual_value ?? '';
    let expectedValue = raw.expected_value ?? '';

    if (!actualValue && !expectedValue && raw.evidence && typeof raw.evidence === 'object') {
      const ev = raw.evidence as Record<string, unknown>;
      actualValue = String(ev.actual ?? '');
      expectedValue = String(ev.expected ?? '');
    }

    if (!actualValue && !expectedValue && typeof raw.evidence === 'string') {
      const evidenceStr = raw.evidence;
      const expMatch = evidenceStr.match(/\(expected:\s*(.+?)\)\s*$/);
      if (expMatch) {
        expectedValue = expMatch[1].trim();
        const beforeParen = evidenceStr.slice(0, evidenceStr.lastIndexOf('('));
        const colonIdx = beforeParen.lastIndexOf(':');
        if (colonIdx >= 0) {
          actualValue = beforeParen.slice(colonIdx + 1).trim() || '(not set)';
        }
      }
    }

    return {
      scanId,
      ruleId: raw.rule_id,
      stigId: raw.stig_id ?? '',
      host,
      status: raw.status,
      severity,
      actualValue,
      expectedValue,
      evidence,
    };
  }

  /**
   * Convert flat StoredFinding[] rows into aggregated MultiHostFinding[]
   * for the frontend. Groups findings by ruleId and collects per-host
   * status into the hosts array.
   */
  aggregateFindings(
    stored: Array<Omit<StoredFinding, 'id'>>,
  ): MultiHostFinding[] {
    return this.storedFindingsToMultiHost(stored as StoredFinding[]);
  }

  async aggregateFindingsWithMetadata(
    stored: Array<Omit<StoredFinding, 'id'>>,
  ): Promise<MultiHostFinding[]> {
    return this.storedFindingsToMultiHostAsync(stored as StoredFinding[]);
  }

  private groupFindingsByRule(stored: StoredFinding[]) {
    const byRule = new Map<string, {
      finding: StoredFinding;
      hosts: Array<{
        host: string;
        status: 'pass' | 'fail' | 'error';
        actualValue: string;
        expectedValue: string;
      }>;
    }>();
    for (const f of stored) {
      let entry = byRule.get(f.ruleId);
      if (!entry) {
        entry = { finding: f, hosts: [] };
        byRule.set(f.ruleId, entry);
      }
      entry.hosts.push({
        host: f.host,
        status: (f.status as 'pass' | 'fail' | 'error') || 'error',
        actualValue: f.actualValue,
        expectedValue: f.expectedValue,
      });
    }
    return byRule;
  }

  private buildMultiHostFindings(
    byRule: ReturnType<ComplianceService['groupFindingsByRule']>,
    dbMeta: Map<string, import('@aap-compliance/common').RuleMetadataRecord>,
    yamlMeta: Map<string, RuleMetadata>,
  ): MultiHostFinding[] {
    const results: MultiHostFinding[] = [];
    for (const [ruleId, entry] of byRule) {
      const passCount = entry.hosts.filter(h => h.status === 'pass').length;
      const failCount = entry.hosts.filter(h => h.status === 'fail').length;
      const dm = dbMeta.get(ruleId);
      const ym = yamlMeta.get(ruleId);
      results.push({
        ruleId,
        stigId: dm?.stigId || entry.finding.stigId,
        title: dm?.title || ym?.title || ruleId,
        description: dm?.description || ym?.description || '',
        fixText: dm?.fixText || ym?.fix_text || '',
        checkText: dm?.checkText || ym?.check_text || '',
        severity: (entry.finding.severity as 'CAT_I' | 'CAT_II' | 'CAT_III') || 'CAT_II',
        category: dm?.category || ym?.category || '',
        disruption: (dm?.disruption || ym?.disruption || 'medium') as 'low' | 'medium' | 'high',
        parameters: (ym?.parameters ?? []).map(p => ({
          name: p.name,
          label: p.label,
          description: p.label,
          type: p.type as 'string' | 'number' | 'boolean' | 'select',
          default: p.default as string | number | boolean,
          value: p.default as string | number | boolean,
          options: p.options as Array<{ label: string; value: string | number }> | undefined,
        })),
        hosts: entry.hosts,
        passCount,
        failCount,
        totalCount: entry.hosts.length,
      });
    }
    return results;
  }

  private async storedFindingsToMultiHostAsync(
    stored: StoredFinding[],
  ): Promise<MultiHostFinding[]> {
    const byRule = this.groupFindingsByRule(stored);
    const ruleIds = Array.from(byRule.keys());
    let dbMeta = new Map<string, import('@aap-compliance/common').RuleMetadataRecord>();
    if (this.database) {
      try {
        dbMeta = await this.database.getRuleMetadataBulk(ruleIds);
      } catch {
        // DB metadata not available (table may not exist yet)
      }
    }
    return this.buildMultiHostFindings(byRule, dbMeta, this.getRulesMetadata());
  }

  private storedFindingsToMultiHost(stored: StoredFinding[]): MultiHostFinding[] {
    const byRule = this.groupFindingsByRule(stored);
    return this.buildMultiHostFindings(byRule, new Map(), this.getRulesMetadata());
  }

  // ─── Scan error details ─────────────────────────────────────────────

  /**
   * Fetch real error details from the Controller for a failed scan.
   *
   * Resolution order:
   *   1. Try fetching workflow nodes — find the failed child job
   *      and extract its result_traceback.
   *   2. If no workflow nodes (single JT per ADR-003), try getting
   *      the job status directly from the workflowJobId.
   *
   * Returns null on any error (best-effort, never breaks the scan flow).
   * Truncates result at 2000 chars.
   */
  async fetchScanErrorDetails(
    workflowJobId: number,
    token?: string,
  ): Promise<string | null> {
    if (!this.controllerClient) {
      return null;
    }

    try {
      // Step 1: Try workflow nodes to find the failed child job
      const nodes = await this.getWorkflowNodes(workflowJobId, token);
      let childJobId: number | null = null;

      if (nodes.length > 0) {
        const failedNode = nodes.find(
          n =>
            n.summary_fields?.job?.status === 'failed' ||
            n.summary_fields?.job?.status === 'error',
        );

        if (failedNode?.summary_fields?.job?.id) {
          childJobId = failedNode.summary_fields.job.id;
          const jobStatus = await this.controllerClient.getJobStatus(
            childJobId,
            token,
          );
          if (jobStatus.result_traceback) {
            this.logger.info(
              `Fetched error traceback for workflow ${workflowJobId} from child job ${childJobId}`,
            );
            return jobStatus.result_traceback.slice(0, 2000);
          }
        }
      }

      // Step 2: No traceback — extract error from job events (failed tasks / unreachable hosts)
      const targetJobId = childJobId ?? workflowJobId;
      const failureEvents = await this.controllerClient.getJobFailureEvents(targetJobId, token);
      if (failureEvents.results.length > 0) {
        const lines: string[] = [];
        for (const ev of failureEvents.results.slice(0, 10)) {
          const data = ev.event_data as Record<string, unknown> | undefined;
          const res = data?.res as Record<string, unknown> | undefined;
          const host = (data?.host as string) ?? 'unknown';
          const task = (data?.task as string) ?? 'unknown';
          const msg = (res?.msg as string) ?? ev.event ?? 'unknown error';
          lines.push(`${host}: [${task}] ${msg}`);
        }
        if (failureEvents.count > 10) {
          lines.push(`... and ${failureEvents.count - 10} more`);
        }
        const details = lines.join('\n');
        this.logger.info(
          `Fetched ${failureEvents.results.length} failure events for job ${targetJobId}`,
        );
        return details.slice(0, 2000);
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch error details for workflow ${workflowJobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  // ─── Workflow status (for polling) ──────────────────────────────────

  async getWorkflowJobStatus(jobId: number, token?: string): Promise<WorkflowJobStatus> {
    if (this.dataSource === 'mock') {
      // Simulate a job that progresses to completion
      return {
        id: jobId,
        status: 'successful',
        finished: new Date().toISOString(),
        failed: false,
        elapsed: 45.2,
        name: 'compliance-scan-mock',
      };
    }

    return this.controllerClient!.getWorkflowJobStatus(jobId, token);
  }

  async getJobStatus(jobId: number, token?: string): Promise<WorkflowJobStatus> {
    if (this.dataSource === 'mock') {
      return {
        id: jobId,
        status: 'successful',
        finished: new Date().toISOString(),
        failed: false,
        elapsed: 30.0,
        name: 'compliance-remediate-mock',
      };
    }
    const result = await this.controllerClient!.getJobStatus(jobId, token);
    return {
      id: result.id,
      status: result.status,
      finished: result.finished,
      failed: result.failed,
      elapsed: result.elapsed,
      name: `job-${result.id}`,
      job_tags: result.job_tags || undefined,
    };
  }

  async getWorkflowNodes(
    jobId: number,
    token?: string,
  ): Promise<WorkflowNode[]> {
    if (this.dataSource === 'mock') {
      return [];
    }

    const result = await this.controllerClient!.getWorkflowNodes(jobId, token);
    return result.results;
  }

  async getJobEvents(jobId: number, token?: string): Promise<JobEvent[]> {
    if (this.dataSource === 'mock') {
      return [];
    }

    const result = await this.controllerClient!.getJobEvents(jobId, token);
    return result.results;
  }

  // ─── Remediation plan builder ────────────────────────────────────────

  /**
   * Build an optimized remediation plan from user selections.
   *
   * Groups rules by their target host set so that rules targeting the
   * same set of hosts are batched into a single Ansible run. This
   * avoids launching one workflow per rule, which does not scale.
   *
   * Each group produces:
   *   { tags: [rule_ids], limit: "host1,host2,...", extra_vars: {overrides}, hostCount, ruleCount }
   */
  buildRemediationPlan(
    selections: RemediationSelection[],
    findings: MultiHostFinding[],
  ): RemediationPlan {
    const enabledSelections = selections.filter(s => s.enabled);

    if (enabledSelections.length === 0) {
      return { groups: [], totalRules: 0, totalHosts: 0 };
    }

    const findingsMap = new Map(findings.map(f => [f.ruleId, f]));

    // For each enabled rule, compute its target host set based on scope
    const ruleHostSets: Array<{
      ruleId: string;
      hosts: string[];
      extraVars: Record<string, unknown>;
    }> = [];

    for (const sel of enabledSelections) {
      const finding = findingsMap.get(sel.ruleId);
      if (!finding) continue;

      // Determine target hosts based on scope (default: failed_only).
      // Check the selection-level scope field first, then fall back to
      // the legacy parameters.scope for backward compatibility.
      const scope = sel.scope ?? (sel.parameters?.scope as string) ?? 'failed_only';
      let targetHosts: string[];

      if (scope === 'standardize_all') {
        targetHosts = finding.hosts.map(h => h.host);
      } else {
        // failed_only: only remediate hosts that failed
        targetHosts = finding.hosts
          .filter(h => h.status === 'fail')
          .map(h => h.host);
      }

      if (targetHosts.length === 0) continue;

      // Collect parameter overrides (exclude internal scope parameter)
      const extraVars: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sel.parameters ?? {})) {
        if (key !== 'scope') {
          extraVars[key] = value;
        }
      }

      ruleHostSets.push({
        ruleId: sel.ruleId,
        hosts: targetHosts.sort(),
        extraVars,
      });
    }

    // Group rules by their sorted host set (same hosts => same group)
    const groupMap = new Map<string, {
      ruleIds: string[];
      hosts: string[];
      mergedExtraVars: Record<string, unknown>;
    }>();

    for (const entry of ruleHostSets) {
      const hostKey = entry.hosts.join(',');
      const existing = groupMap.get(hostKey);

      if (existing) {
        existing.ruleIds.push(entry.ruleId);
        Object.assign(existing.mergedExtraVars, entry.extraVars);
      } else {
        groupMap.set(hostKey, {
          ruleIds: [entry.ruleId],
          hosts: entry.hosts,
          mergedExtraVars: { ...entry.extraVars },
        });
      }
    }

    // Build the final plan
    const allHosts = new Set<string>();
    const groups: RemediationPlanGroup[] = [];

    for (const group of groupMap.values()) {
      group.hosts.forEach(h => allHosts.add(h));
      groups.push({
        tags: group.ruleIds,
        limit: group.hosts.join(','),
        extraVars: group.mergedExtraVars,
        hostCount: group.hosts.length,
        ruleCount: group.ruleIds.length,
      });
    }

    // Sort groups: largest first for efficiency visibility
    groups.sort((a, b) => b.ruleCount - a.ruleCount || b.hostCount - a.hostCount);

    const plan: RemediationPlan = {
      groups,
      totalRules: enabledSelections.length,
      totalHosts: allHosts.size,
    };

    this.logger.info(
      `Built remediation plan: ${plan.groups.length} groups covering ${plan.totalRules} rules across ${plan.totalHosts} hosts`,
    );

    return plan;
  }

  // ─── Dashboard ──────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getDashboardStats();
    }

    const empty: DashboardStats = {
      hostsScanned: 0,
      criticalFindings: 0,
      pendingRemediation: 0,
      activeProfiles: 0,
      recentScans: [],
      frameworkScores: [],
    };

    if (!this.database) return empty;

    try {
      const scans = await this.database.getRecentScans(10);
      const profiles = await this.database.listCartridges();

      // Resolve inventory names from Controller
      const inventoryNameMap = new Map<number, string>();
      try {
        const inventories = await this.getInventories();
        for (const inv of inventories) {
          inventoryNameMap.set(inv.id, inv.name);
        }
      } catch {
        // Controller unavailable — fall back to "Inventory N"
      }
      const completedScans = scans.filter(s => s.status === 'completed' && s.scanner !== 'remediation');

      const hostsSet = new Set<string>();
      let criticalFindings = 0;
      let pendingRemediation = 0;
      const profileStats = new Map<string, { pass: number; fail: number; rules: number; lastScan: string }>();

      // Use only the latest completed scan per profile
      const latestByProfile = new Map<string, typeof completedScans[0]>();
      for (const scan of completedScans) {
        const existing = latestByProfile.get(scan.profileId);
        if (!existing || (scan.completedAt && scan.completedAt > (existing.completedAt || ''))) {
          latestByProfile.set(scan.profileId, scan);
        }
      }

      for (const scan of latestByProfile.values()) {
        const findings = await this.database.getFindingsByScanId(scan.id);
        const uniqueRules = new Set(findings.map(f => f.ruleId));
        for (const f of findings) {
          hostsSet.add(f.host);
          if (f.status === 'fail') {
            pendingRemediation++;
            if (f.severity === 'CAT_I') criticalFindings++;
          }
        }

        const pass = findings.filter(f => f.status === 'pass').length;
        const fail = findings.filter(f => f.status === 'fail').length;
        profileStats.set(scan.profileId, {
          pass, fail, rules: uniqueRules.size,
          lastScan: scan.completedAt || scan.startedAt,
        });
      }

      const profileNameMap = new Map(profiles.map(p => [p.id, p.displayName]));

      // Include ALL recent scans with per-scan pass rates.
      const recentScansRaw = scans.slice(0, 8);
      const recentScans = await Promise.all(
        recentScansRaw.map(async scan => {
          let passRate = 0;
          if (scan.status === 'completed' && scan.scanner !== 'remediation') {
            const scanFindings = await this.database!.getFindingsByScanId(scan.id);
            if (scanFindings.length > 0) {
              const pass = scanFindings.filter(f => f.status === 'pass').length;
              passRate = Math.round((pass / scanFindings.length) * 100);
            }
          }
          return {
            id: scan.id,
            profileName: profileNameMap.get(scan.profileId) || scan.profileId,
            inventoryName: inventoryNameMap.get(scan.inventoryId) || `Inventory ${scan.inventoryId}`,
            passRate,
            timestamp: scan.completedAt || scan.startedAt,
            status: scan.status,
            scanType: scan.scanType,
            scanner: scan.scanner,
          };
        }),
      );

      const frameworkScores = Array.from(profileStats.entries()).map(([pid, stats]) => {
        const total = stats.pass + stats.fail;
        return {
          profileId: pid,
          name: profileNameMap.get(pid) || pid,
          target: 'RHEL 9',
          rules: stats.rules,
          rate: total > 0 ? Math.round((stats.pass / total) * 100) : 0,
          lastScan: stats.lastScan,
        };
      });

      return {
        hostsScanned: hostsSet.size,
        criticalFindings,
        pendingRemediation,
        activeProfiles: profiles.length,
        recentScans,
        frameworkScores,
      };
    } catch (error) {
      this.logger.warn(`Dashboard stats aggregation failed: ${error}`);
      return empty;
    }
  }

  // ─── Posture history ────────────────────────────────────────────────

  async getPostureHistory(
    profileId?: string,
    days?: number,
  ): Promise<PostureSnapshot[]> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getPostureHistory(profileId, days);
    }
    if (!this.database) return [];
    return this.database.getPostureHistory(profileId, days);
  }

  // ─── Remediations (saved rule selections) ──────────────────────────

  async getRemediationProfiles(): Promise<RemediationProfile[]> {
    if (this.dataSource === 'mock') {
      return MockDataProvider.getRemediationProfiles();
    }
    if (!this.database) return [];
    return this.database.listRemediationProfiles();
  }

  async getRemediationProfile(id: string): Promise<RemediationProfile | null> {
    if (this.dataSource === 'mock') {
      const profiles = await MockDataProvider.getRemediationProfiles();
      return profiles.find(p => p.id === id) ?? null;
    }
    if (!this.database) return null;
    return this.database.getRemediationProfile(id);
  }

  async saveRemediationProfile(
    request: SaveRemediationProfileRequest,
  ): Promise<RemediationProfile> {
    // In live mode with a database, persist to the DB
    if (this.dataSource === 'live' && this.database) {
      const saved = await this.database.saveRemediationProfile({
        id: request.id,
        name: request.name,
        description: request.description,
        profileId: request.complianceProfileId,
        scanId: request.scanId,
        selections: request.selections,
      });
      return {
        id: saved.id,
        name: request.name,
        description: request.description,
        complianceProfileId: request.complianceProfileId,
        scanId: request.scanId,
        targetInventory: '',
        selections: request.selections,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // In mock mode (or live mode without DB), use the in-memory mock store
    const profile: RemediationProfile = {
      id: '',
      name: request.name,
      description: request.description,
      complianceProfileId: request.complianceProfileId,
      scanId: request.scanId,
      targetInventory: '',
      selections: request.selections,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return MockDataProvider.saveRemediationProfile(profile);
  }

  async deleteRemediationProfile(id: string): Promise<boolean> {
    if (this.dataSource === 'live' && this.database) {
      return this.database.deleteRemediationProfile(id);
    }
    return MockDataProvider.deleteRemediationProfile(id);
  }
}

/**
 * Knex-based data access layer for compliance plugin persistence.
 */
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

import type {
  ComplianceScan,
  StoredFinding,
  FindingState,
  PostureSnapshot,
  RemediationProfile,
  RemediationSelection,
  ComplianceProfile,
  SaveProfileRequest,
  RuleMetadataRecord,
  RemediationExecution,
  RemediationExecutionStatus,
  RemediationProfileStatus,
  BaselineTarget,
} from '@aap-compliance/common';

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function toISOStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toISOString(value);
}

function safeJsonParse<T>(value: unknown): T | null {
  if (!value) return null;
  try { return JSON.parse(value as string); } catch { return null; }
}

export class ComplianceDatabase {
  constructor(private readonly db: Knex) {}

  // ─── Scans ──────────────────────────────────────────────────────────

  async createScan(scan: Omit<ComplianceScan, 'id'>): Promise<ComplianceScan> {
    const id = randomUUID();
    const row = { id, ...scan };
    await this.db('compliance_scans').insert({
      id: row.id,
      profile_id: row.profileId,
      inventory_id: row.inventoryId,
      scanner: row.scanner,
      scan_type: row.scanType || 'assessment',
      workflow_job_id: row.workflowJobId,
      status: row.status,
      started_at: row.startedAt,
      completed_at: row.completedAt,
    });
    return { ...row, id };
  }

  async updateScanWorkflowJobId(scanId: string, workflowJobId: number): Promise<void> {
    await this.db('compliance_scans').where('id', scanId).update({ workflow_job_id: workflowJobId });
  }

  async updateScanStatus(
    scanId: string,
    status: string,
    completedAt?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (completedAt) {
      update.completed_at = completedAt;
    }
    await this.db('compliance_scans').where('id', scanId).update(update);
  }

  async getScanById(id: string): Promise<ComplianceScan | null> {
    const row = await this.db('compliance_scans').where('id', id).first();
    if (!row) return null;
    return this.mapScanRow(row);
  }

  async getScanByWorkflowJobId(workflowJobId: number): Promise<ComplianceScan | null> {
    const row = await this.db('compliance_scans')
      .where('workflow_job_id', workflowJobId)
      .first();
    if (!row) return null;
    return this.mapScanRow(row);
  }

  /**
   * Persist findings for an existing scan record.
   * Unlike saveScanResults (which creates the scan too), this method
   * attaches findings to an already-created scan row.
   */
  async saveFindingsForScan(
    scanId: string,
    findings: Array<Omit<StoredFinding, 'id'>>,
  ): Promise<number> {
    if (findings.length === 0) return 0;

    const rows = findings.map(f => ({
      id: randomUUID(),
      scan_id: scanId,
      rule_id: f.ruleId,
      stig_id: f.stigId,
      host: f.host,
      status: f.status,
      severity: f.severity,
      actual_value: f.actualValue,
      expected_value: f.expectedValue,
      evidence: f.evidence,
      finding_state: f.findingState ?? null,
    }));

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      await this.db('compliance_findings').insert(rows.slice(i, i + batchSize));
    }

    return findings.length;
  }

  /**
   * Find the most recent completed assessment scan for the same profile
   * that was completed before the given scan. Used to provide before/after
   * comparison for verification scans.
   */
  async getPreviousScan(currentScan: ComplianceScan): Promise<ComplianceScan | null> {
    const row = await this.db('compliance_scans')
      .where('profile_id', currentScan.profileId)
      .where('scan_type', 'assessment')
      .where('status', 'completed')
      .where('scanner', 'oscap')
      .where('started_at', '<', currentScan.startedAt)
      .orderBy('started_at', 'desc')
      .first();
    if (!row) return null;
    return this.mapScanRow(row);
  }

  async getPreviousScanForInventory(
    profileId: string,
    inventoryId: number,
    beforeTimestamp: string,
  ): Promise<ComplianceScan | null> {
    const row = await this.db('compliance_scans')
      .where('profile_id', profileId)
      .where('inventory_id', inventoryId)
      .where('scan_type', 'assessment')
      .where('status', 'completed')
      .where('scanner', 'oscap')
      .where('started_at', '<', beforeTimestamp)
      .orderBy('started_at', 'desc')
      .first();
    if (!row) return null;
    return this.mapScanRow(row);
  }

  /**
   * Compute finding-level states for a scan by comparing against the
   * previous scan for the same (profile, inventory). Updates finding_state
   * in-place via batch UPDATE.
   */
  async computeFindingStates(
    scanId: string,
    profileId: string,
    inventoryId: number,
  ): Promise<void> {
    const scan = await this.getScanById(scanId);
    if (!scan) return;

    const prevScan = await this.getPreviousScanForInventory(
      profileId,
      inventoryId,
      scan.startedAt,
    );

    const currentFindings = await this.db('compliance_findings')
      .where('scan_id', scanId)
      .select('id', 'rule_id', 'host', 'status');

    if (currentFindings.length === 0) return;

    // Build lookup from previous scan
    const prevMap = new Map<string, { status: string; findingState: string | null }>();
    if (prevScan) {
      const prevFindings = await this.db('compliance_findings')
        .where('scan_id', prevScan.id)
        .select('rule_id', 'host', 'status', 'finding_state');
      for (const pf of prevFindings) {
        prevMap.set(
          `${pf.rule_id}|${pf.host}`,
          { status: pf.status as string, findingState: pf.finding_state as string | null },
        );
      }
    }

    // Compute states and batch update
    const updates: Array<{ id: string; state: FindingState | null }> = [];
    for (const cf of currentFindings) {
      const key = `${cf.rule_id}|${cf.host}`;
      const prev = prevMap.get(key);
      let state: FindingState | null = null;

      if (cf.status === 'fail') {
        if (!prev) {
          state = 'new';
        } else if (prev.status === 'fail') {
          state = 'active';
        } else if (prev.status === 'pass' && prev.findingState === 'fixed') {
          state = 'resurfaced';
        } else {
          state = 'new';
        }
      } else if (cf.status === 'pass') {
        if (prev && prev.status === 'fail') {
          state = 'fixed';
        }
      }

      updates.push({ id: cf.id as string, state });
    }

    // Group by state and do bulk UPDATEs (4 statements max, regardless of finding count)
    const byState = new Map<string | null, string[]>();
    for (const u of updates) {
      const key = u.state ?? '__null__';
      let ids = byState.get(key);
      if (!ids) { ids = []; byState.set(key, ids); }
      ids.push(u.id);
    }
    for (const [key, ids] of byState) {
      if (key === '__null__') continue;
      const batchSize = 500;
      for (let i = 0; i < ids.length; i += batchSize) {
        await this.db('compliance_findings')
          .whereIn('id', ids.slice(i, i + batchSize))
          .update({ finding_state: key });
      }
    }
  }

  async getRecentScans(limit: number = 10): Promise<ComplianceScan[]> {
    const rows = await this.db('compliance_scans')
      .orderBy('started_at', 'desc')
      .limit(limit);
    return rows.map(this.mapScanRow);
  }

  async getLatestScanPerProfileInventory(): Promise<ComplianceScan[]> {
    const rows = await this.db('compliance_scans as s')
      .join(
        this.db('compliance_scans')
          .select('profile_id', 'inventory_id')
          .max('completed_at as max_completed')
          .where('status', 'completed')
          .whereNot('scanner', 'remediation')
          .groupBy('profile_id', 'inventory_id')
          .as('latest'),
        function () {
          this.on('s.profile_id', 'latest.profile_id')
            .andOn('s.inventory_id', 'latest.inventory_id')
            .andOn('s.completed_at', 'latest.max_completed');
        },
      )
      .where('s.status', 'completed')
      .whereNot('s.scanner', 'remediation')
      .orderBy('s.completed_at', 'desc');
    return rows.map(this.mapScanRow);
  }

  async getAuthoritativeScan(profileId: string, inventoryId: number): Promise<ComplianceScan | null> {
    const row = await this.db('compliance_scans')
      .where('profile_id', profileId)
      .where('inventory_id', inventoryId)
      .where('scanner', 'oscap')
      .where('scan_type', 'assessment')
      .where('status', 'completed')
      .orderBy('completed_at', 'desc')
      .first();
    if (!row) return null;
    return this.mapScanRow(row);
  }

  private mapScanRow(row: Record<string, unknown>): ComplianceScan {
    return {
      id: row.id as string,
      profileId: row.profile_id as string,
      inventoryId: row.inventory_id as number,
      scanner: row.scanner as string,
      scanType: (row.scan_type as ComplianceScan['scanType']) || 'assessment',
      workflowJobId: row.workflow_job_id as number | null,
      status: row.status as ComplianceScan['status'],
      startedAt: toISOString(row.started_at),
      completedAt: toISOStringOrNull(row.completed_at),
      errorDetails: (row.error_details as string) ?? null,
    };
  }

  // ─── Scan error details ────────────────────────────────────────────

  async updateScanErrorDetails(scanId: string, errorDetails: string): Promise<void> {
    await this.db('compliance_scans').where('id', scanId).update({ error_details: errorDetails });
  }

  // ─── Ingest tokens ─────────────────────────────────────────────────

  async storeIngestToken(scanId: string, token: string): Promise<void> {
    await this.db('compliance_scans').where('id', scanId).update({ ingest_token: token });
  }

  async getIngestToken(scanId: string): Promise<string | null> {
    const row = await this.db('compliance_scans').where('id', scanId).select('ingest_token').first();
    if (!row) return null;
    return (row.ingest_token as string) || null;
  }

  // ─── Data retention ─────────────────────────────────────────────────

  /**
   * Delete findings from scans older than the specified number of days.
   *
   * Keeps the scan records (for history) but removes the findings data
   * to prevent unbounded table growth. Returns the number of findings
   * deleted.
   */
  async cleanupOldFindings(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffISO = cutoff.toISOString();

    // Find scans older than the retention cutoff
    const oldScanIds = await this.db('compliance_scans')
      .where('started_at', '<', cutoffISO)
      .select('id');

    if (oldScanIds.length === 0) return 0;

    const ids = oldScanIds.map(row => row.id as string);

    // Delete findings belonging to those scans
    const deleted = await this.db('compliance_findings')
      .whereIn('scan_id', ids)
      .delete();

    return deleted;
  }

  // ─── Findings ───────────────────────────────────────────────────────

  async saveScanResults(
    scan: Omit<ComplianceScan, 'id'>,
    findings: Array<Omit<StoredFinding, 'id'>>,
  ): Promise<{ scanId: string; findingCount: number }> {
    const savedScan = await this.createScan(scan);

    if (findings.length > 0) {
      const rows = findings.map(f => ({
        id: randomUUID(),
        scan_id: savedScan.id,
        rule_id: f.ruleId,
        stig_id: f.stigId,
        host: f.host,
        status: f.status,
        severity: f.severity,
        actual_value: f.actualValue,
        expected_value: f.expectedValue,
        evidence: f.evidence,
        finding_state: f.findingState ?? null,
      }));

      // Insert in batches of 100 to avoid query size limits
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        await this.db('compliance_findings').insert(rows.slice(i, i + batchSize));
      }
    }

    return { scanId: savedScan.id, findingCount: findings.length };
  }

  async getLatestFindings(profileId?: string): Promise<StoredFinding[]> {
    // Find the most recent scan that has findings (any status).
    // Previously this only searched completed scans, but scans may have
    // findings stored before their status is flipped to "completed"
    // (the status update happens in the /findings route). This caused
    // rule counts to show 0 until a user manually viewed the results.
    let scanQuery = this.db('compliance_scans')
      .whereExists(
        this.db('compliance_findings')
          .whereRaw('compliance_findings.scan_id = compliance_scans.id')
          .select(this.db.raw('1')),
      )
      .orderBy('started_at', 'desc')
      .first();

    if (profileId) {
      scanQuery = scanQuery.where('profile_id', profileId);
    }

    const scan = await scanQuery;
    if (!scan) return [];

    const rows = await this.db('compliance_findings')
      .where('scan_id', scan.id)
      .orderBy('severity', 'asc');

    return rows.map(this.mapFindingRow);
  }

  async getFindingsByScanId(scanId: string): Promise<StoredFinding[]> {
    const rows = await this.db('compliance_findings')
      .where('scan_id', scanId)
      .orderBy('severity', 'asc');
    return rows.map(this.mapFindingRow);
  }

  async getAggregatedStatsByScanIds(scanIds: string[]): Promise<Map<string, { pass: number; fail: number; catI: number; hosts: Set<string>; rules: Set<string> }>> {
    if (scanIds.length === 0) return new Map();
    const rows = await this.db('compliance_findings')
      .select('scan_id', 'status', 'severity', 'host', 'rule_id')
      .whereIn('scan_id', scanIds);
    const result = new Map<string, { pass: number; fail: number; catI: number; hosts: Set<string>; rules: Set<string> }>();
    for (const row of rows) {
      const sid = row.scan_id as string;
      let entry = result.get(sid);
      if (!entry) {
        entry = { pass: 0, fail: 0, catI: 0, hosts: new Set(), rules: new Set() };
        result.set(sid, entry);
      }
      entry.hosts.add(row.host as string);
      entry.rules.add(row.rule_id as string);
      if (row.status === 'pass') entry.pass++;
      if (row.status === 'fail') {
        entry.fail++;
        if (row.severity === 'CAT_I') entry.catI++;
      }
    }
    return result;
  }

  async getBatchScanStatsAggregated(scanIds: string[]): Promise<Record<string, { pass: number; fail: number; rules: number; hosts: number; stateNew: number; stateFixed: number; stateResurfaced: number }>> {
    if (scanIds.length === 0) return {};
    const rows = await this.db('compliance_findings')
      .select('scan_id')
      .count({ total: '*' })
      .sum({ pass_count: this.db.raw("CASE WHEN status = 'pass' THEN 1 ELSE 0 END") })
      .sum({ fail_count: this.db.raw("CASE WHEN status = 'fail' THEN 1 ELSE 0 END") })
      .sum({ state_new: this.db.raw("CASE WHEN finding_state = 'new' THEN 1 ELSE 0 END") })
      .sum({ state_fixed: this.db.raw("CASE WHEN finding_state = 'fixed' THEN 1 ELSE 0 END") })
      .sum({ state_resurfaced: this.db.raw("CASE WHEN finding_state = 'resurfaced' THEN 1 ELSE 0 END") })
      .countDistinct({ rule_count: 'rule_id' })
      .countDistinct({ host_count: 'host' })
      .whereIn('scan_id', scanIds)
      .groupBy('scan_id');
    const result: Record<string, { pass: number; fail: number; rules: number; hosts: number; stateNew: number; stateFixed: number; stateResurfaced: number }> = {};
    for (const row of rows as Array<Record<string, unknown>>) {
      result[row.scan_id as string] = {
        pass: Number(row.pass_count) || 0,
        fail: Number(row.fail_count) || 0,
        rules: Number(row.rule_count) || 0,
        hosts: Number(row.host_count) || 0,
        stateNew: Number(row.state_new) || 0,
        stateFixed: Number(row.state_fixed) || 0,
        stateResurfaced: Number(row.state_resurfaced) || 0,
      };
    }
    return result;
  }

  private mapFindingRow(row: Record<string, unknown>): StoredFinding {
    return {
      id: row.id as string,
      scanId: row.scan_id as string,
      ruleId: row.rule_id as string,
      stigId: row.stig_id as string,
      host: row.host as string,
      status: row.status as string,
      severity: row.severity as string,
      actualValue: row.actual_value as string,
      expectedValue: row.expected_value as string,
      evidence: (row.evidence as string | null) ?? null,
      findingState: (row.finding_state as FindingState | null) ?? null,
    };
  }

  // ─── Posture snapshots ──────────────────────────────────────────────

  async savePostureSnapshot(
    snapshot: Omit<PostureSnapshot, 'id'>,
  ): Promise<PostureSnapshot> {
    const id = randomUUID();
    await this.db('compliance_posture_snapshots').insert({
      id,
      profile_id: snapshot.profileId,
      inventory_id: snapshot.inventoryId ?? null,
      scan_id: snapshot.scanId ?? null,
      timestamp: snapshot.timestamp,
      total_hosts: snapshot.totalHosts,
      total_rules: snapshot.totalRules,
      pass_count: snapshot.passCount,
      fail_count: snapshot.failCount,
      compliance_pct: snapshot.compliancePct,
    });
    return { ...snapshot, id };
  }

  async getPostureHistory(
    profileId?: string,
    days: number = 30,
  ): Promise<PostureSnapshot[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let query = this.db('compliance_posture_snapshots')
      .where('timestamp', '>=', cutoff.toISOString())
      .orderBy('timestamp', 'asc');

    if (profileId) {
      query = query.where('profile_id', profileId);
    }

    const rows = await query;

    return rows.map(this.mapPostureRow);
  }

  private mapPostureRow(row: Record<string, unknown>): PostureSnapshot {
    return {
      id: row.id as string,
      profileId: row.profile_id as string,
      inventoryId: (row.inventory_id as number) ?? undefined,
      scanId: (row.scan_id as string) ?? undefined,
      timestamp: toISOString(row.timestamp),
      totalHosts: row.total_hosts as number,
      totalRules: row.total_rules as number,
      passCount: row.pass_count as number,
      failCount: row.fail_count as number,
      compliancePct: row.compliance_pct as number,
    };
  }

  // ─── Remediation profiles ──────────────────────────────────────────

  async saveRemediationProfile(
    profile: {
      id?: string;
      name: string;
      description: string;
      profileId: string;
      creationScanId?: string;
      /** @deprecated Use creationScanId */
      scanId?: string;
      selections: RemediationSelection[];
      status?: RemediationProfileStatus;
      createdBy?: string;
    },
  ): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const scanId = profile.creationScanId ?? profile.scanId ?? null;
    const status = profile.status ?? 'saved';

    if (profile.id) {
      await this.db('compliance_remediation_profiles')
        .where('id', profile.id)
        .update({
          name: profile.name,
          description: profile.description,
          profile_id: profile.profileId,
          creation_scan_id: scanId,
          selections_json: JSON.stringify(profile.selections),
          status,
          updated_at: now,
        });
      return { id: profile.id };
    }

    const id = randomUUID();
    await this.db('compliance_remediation_profiles').insert({
      id,
      name: profile.name,
      description: profile.description,
      profile_id: profile.profileId,
      creation_scan_id: scanId,
      selections_json: JSON.stringify(profile.selections),
      status,
      created_by: profile.createdBy ?? null,
      created_at: now,
      updated_at: now,
    });
    return { id };
  }

  async listRemediationProfiles(statusFilter?: RemediationProfileStatus | 'all'): Promise<RemediationProfile[]> {
    let query = this.db('compliance_remediation_profiles')
      .select('compliance_remediation_profiles.*')
      .select(
        this.db.raw('(SELECT COUNT(*) FROM compliance_remediation_executions WHERE remediation_profile_id = compliance_remediation_profiles.id) as execution_count'),
      )
      .select(
        this.db.raw('(SELECT MAX(started_at) FROM compliance_remediation_executions WHERE remediation_profile_id = compliance_remediation_profiles.id) as last_executed_at'),
      )
      .orderBy('created_at', 'desc');

    if (statusFilter && statusFilter !== 'all') {
      query = query.where('compliance_remediation_profiles.status', statusFilter);
    } else if (!statusFilter) {
      query = query.whereNot('compliance_remediation_profiles.status', 'archived');
    }

    const rows = await query;
    const profiles = rows.map((row: Record<string, unknown>) => this.mapRemediationProfileRow(row));

    if (profiles.length === 0) return profiles;

    const profileIds = profiles.map(p => p.id);
    const latestExecs = await this.db('compliance_remediation_executions as e1')
      .whereIn('e1.remediation_profile_id', profileIds)
      .whereRaw('e1.id = (SELECT e2.id FROM compliance_remediation_executions e2 WHERE e2.remediation_profile_id = e1.remediation_profile_id ORDER BY e2.started_at DESC, e2.id DESC LIMIT 1)')
      .select('*');

    const execByProfile = new Map<string, RemediationExecution>();
    for (const row of latestExecs) {
      execByProfile.set(row.remediation_profile_id as string, this.mapExecutionRow(row));
    }
    for (const profile of profiles) {
      profile.latestExecution = execByProfile.get(profile.id) ?? null;
    }

    return profiles;
  }

  async updateRemediationProfileStatus(id: string, status: RemediationProfileStatus): Promise<boolean> {
    const updated = await this.db('compliance_remediation_profiles')
      .where('id', id)
      .update({ status, updated_at: new Date().toISOString() });
    return updated > 0;
  }

  async getRemediationProfile(id: string): Promise<RemediationProfile | null> {
    const row = await this.db('compliance_remediation_profiles')
      .select('compliance_remediation_profiles.*')
      .select(
        this.db.raw('(SELECT COUNT(*) FROM compliance_remediation_executions WHERE remediation_profile_id = compliance_remediation_profiles.id) as execution_count'),
      )
      .select(
        this.db.raw('(SELECT MAX(started_at) FROM compliance_remediation_executions WHERE remediation_profile_id = compliance_remediation_profiles.id) as last_executed_at'),
      )
      .where('compliance_remediation_profiles.id', id)
      .first();
    if (!row) return null;
    const profile = this.mapRemediationProfileRow(row);
    const latestExec = await this.db('compliance_remediation_executions')
      .where('remediation_profile_id', id)
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .first();
    profile.latestExecution = latestExec ? this.mapExecutionRow(latestExec) : null;
    return profile;
  }

  /**
   * Delete a remediation profile. Only drafts with no execution history
   * can be deleted (ADR-014 Q6). Saved/archived profiles should be
   * archived instead. Returns false if not found, throws if blocked by FK.
   */
  async deleteRemediationProfile(id: string): Promise<boolean> {
    const profile = await this.getRemediationProfile(id);
    if (!profile) return false;
    if (profile.status !== 'draft') {
      throw new Error('Only draft profiles can be deleted. Use archive for saved profiles.');
    }
    const executions = await this.getExecutionsByProfileId(id, 1);
    if (executions.length > 0) {
      throw new Error('Cannot delete a profile with execution history.');
    }
    const deleted = await this.db('compliance_remediation_profiles')
      .where('id', id)
      .delete();
    return deleted > 0;
  }

  private mapRemediationProfileRow(row: Record<string, unknown>): RemediationProfile {
    let selections: RemediationSelection[] = [];
    try {
      selections = JSON.parse(row.selections_json as string);
    } catch {
      // corrupted data — return empty
    }
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      complianceProfileId: row.profile_id as string,
      creationScanId: (row.creation_scan_id as string) || undefined,
      targetInventory: '',
      status: (row.status as RemediationProfileStatus) || 'saved',
      createdBy: (row.created_by as string) || undefined,
      selections,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
      executionCount: (row.execution_count as number) ?? undefined,
      lastExecutedAt: toISOStringOrNull(row.last_executed_at),
      latestExecution: null,
    };
  }

  // ─── Remediation executions (ADR-014 §1) ───────────────────────────

  /**
   * Create an execution record and enforce the concurrent execution guard.
   * Uses the partial unique index on (inventory_id) WHERE status IN ('pending','running')
   * to prevent TOCTOU races. Returns null if the inventory is already locked.
   */
  async createExecution(execution: {
    remediationProfileId: string;
    inventoryId: number;
    informingScanId?: string;
    planSummary?: object;
    createdBy?: string;
  }): Promise<RemediationExecution | null> {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await this.db('compliance_remediation_executions').insert({
        id,
        remediation_profile_id: execution.remediationProfileId,
        inventory_id: execution.inventoryId,
        informing_scan_id: execution.informingScanId ?? null,
        primary_job_id: null,
        all_job_ids: null,
        status: 'pending',
        started_at: now,
        completed_at: null,
        elapsed_seconds: null,
        rules_applied: null,
        rules_failed: null,
        hosts_targeted: null,
        hosts_succeeded: null,
        hosts_failed: null,
        plan_summary: execution.planSummary ? JSON.stringify(execution.planSummary) : null,
        verification_scan_id: null,
        created_by: execution.createdBy ?? null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const code = (err as Record<string, unknown>).code;
      if (
        msg.includes('UNIQUE constraint failed') ||  // SQLite
        msg.includes('duplicate key value violates unique constraint') ||  // PostgreSQL
        code === '23505'  // PostgreSQL error code
      ) {
        return null; // concurrent execution guard triggered
      }
      throw err;
    }
    return this.getExecutionById(id);
  }

  async getExecutionById(id: string): Promise<RemediationExecution | null> {
    const row = await this.db('compliance_remediation_executions').where('id', id).first();
    if (!row) return null;
    return this.mapExecutionRow(row);
  }

  async getExecutionsByProfileId(profileId: string, limit: number = 20): Promise<RemediationExecution[]> {
    const rows = await this.db('compliance_remediation_executions')
      .where('remediation_profile_id', profileId)
      .orderBy('started_at', 'desc')
      .limit(limit);
    return rows.map((row: Record<string, unknown>) => this.mapExecutionRow(row));
  }

  async getRecentExecutions(limit: number = 50): Promise<RemediationExecution[]> {
    const rows = await this.db('compliance_remediation_executions')
      .orderBy('started_at', 'desc')
      .limit(limit);
    return rows.map((row: Record<string, unknown>) => this.mapExecutionRow(row));
  }

  /** Get the currently running/pending execution for an inventory (for UI display). */
  async getRunningExecutionForInventory(inventoryId: number): Promise<RemediationExecution | null> {
    const row = await this.db('compliance_remediation_executions')
      .where('inventory_id', inventoryId)
      .whereIn('status', ['pending', 'running'])
      .first();
    if (!row) return null;
    return this.mapExecutionRow(row);
  }

  async updateExecutionStatus(
    id: string,
    update: {
      status: RemediationExecutionStatus;
      completedAt?: string;
      elapsedSeconds?: number;
      primaryJobId?: number;
      allJobIds?: number[];
      rulesApplied?: number;
      rulesFailed?: number;
      hostsTargeted?: number;
      hostsSucceeded?: number;
      hostsFailed?: number;
    },
  ): Promise<void> {
    const row: Record<string, unknown> = { status: update.status };
    if (update.completedAt !== undefined) row.completed_at = update.completedAt;
    if (update.elapsedSeconds !== undefined) row.elapsed_seconds = update.elapsedSeconds;
    if (update.primaryJobId !== undefined) row.primary_job_id = update.primaryJobId;
    if (update.allJobIds !== undefined) row.all_job_ids = JSON.stringify(update.allJobIds);
    if (update.rulesApplied !== undefined) row.rules_applied = update.rulesApplied;
    if (update.rulesFailed !== undefined) row.rules_failed = update.rulesFailed;
    if (update.hostsTargeted !== undefined) row.hosts_targeted = update.hostsTargeted;
    if (update.hostsSucceeded !== undefined) row.hosts_succeeded = update.hostsSucceeded;
    if (update.hostsFailed !== undefined) row.hosts_failed = update.hostsFailed;
    await this.db('compliance_remediation_executions').where('id', id).update(row);
  }

  async updateVerificationScanId(executionId: string, scanId: string): Promise<void> {
    await this.db('compliance_remediation_executions')
      .where('id', executionId)
      .update({ verification_scan_id: scanId });
  }

  /**
   * Recover stale executions stuck in running state (ADR-014 architect review).
   * Returns IDs of executions that need Controller status reconciliation.
   */
  async getStaleRunningExecutions(maxAgeHours: number = 4): Promise<RemediationExecution[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - maxAgeHours);
    const rows = await this.db('compliance_remediation_executions')
      .whereIn('status', ['pending', 'running'])
      .where('started_at', '<', cutoff.toISOString());
    return rows.map((row: Record<string, unknown>) => this.mapExecutionRow(row));
  }

  private mapExecutionRow(row: Record<string, unknown>): RemediationExecution {
    return {
      id: row.id as string,
      remediationProfileId: row.remediation_profile_id as string,
      inventoryId: row.inventory_id as number,
      informingScanId: (row.informing_scan_id as string) ?? null,
      primaryJobId: (row.primary_job_id as number) ?? null,
      allJobIds: safeJsonParse<number[]>(row.all_job_ids) ?? [],
      status: row.status as RemediationExecutionStatus,
      startedAt: toISOString(row.started_at),
      completedAt: toISOStringOrNull(row.completed_at),
      elapsedSeconds: (row.elapsed_seconds as number) ?? null,
      rulesApplied: (row.rules_applied as number) ?? null,
      rulesFailed: (row.rules_failed as number) ?? null,
      hostsTargeted: (row.hosts_targeted as number) ?? null,
      hostsSucceeded: (row.hosts_succeeded as number) ?? null,
      hostsFailed: (row.hosts_failed as number) ?? null,
      planSummary: safeJsonParse(row.plan_summary),
      verificationScanId: (row.verification_scan_id as string) ?? null,
      createdBy: (row.created_by as string) ?? null,
    };
  }

  // ─── Baseline targets (ADR-014 §7) ────────────────────────────────

  async pinBaselineTarget(target: {
    remediationProfileId: string;
    complianceProfileId: string;
    inventoryId: number;
    pinnedBy?: string;
  }): Promise<BaselineTarget> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db('compliance_baseline_targets').insert({
      id,
      remediation_profile_id: target.remediationProfileId,
      compliance_profile_id: target.complianceProfileId,
      inventory_id: target.inventoryId,
      pinned_at: now,
      pinned_by: target.pinnedBy ?? null,
    });
    return {
      id,
      remediationProfileId: target.remediationProfileId,
      complianceProfileId: target.complianceProfileId,
      inventoryId: target.inventoryId,
      pinnedAt: now,
      pinnedBy: target.pinnedBy ?? null,
    };
  }

  async unpinBaselineTarget(id: string): Promise<boolean> {
    const deleted = await this.db('compliance_baseline_targets').where('id', id).delete();
    return deleted > 0;
  }

  async getBaselineTargetsForProfile(complianceProfileId: string): Promise<BaselineTarget[]> {
    const rows = await this.db('compliance_baseline_targets')
      .where('compliance_profile_id', complianceProfileId);
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      remediationProfileId: row.remediation_profile_id as string,
      complianceProfileId: row.compliance_profile_id as string,
      inventoryId: row.inventory_id as number,
      pinnedAt: toISOString(row.pinned_at),
      pinnedBy: (row.pinned_by as string) ?? null,
    }));
  }

  async isProfilePinnedAsBaseline(remediationProfileId: string): Promise<boolean> {
    const row = await this.db('compliance_baseline_targets')
      .where('remediation_profile_id', remediationProfileId)
      .first();
    return !!row;
  }

  // ─── Rule metadata ─────────────────────────────────────────────────

  async upsertRuleMetadata(rules: RuleMetadataRecord[]): Promise<number> {
    if (rules.length === 0) return 0;

    const now = new Date().toISOString();
    const batchSize = 100;

    for (let i = 0; i < rules.length; i += batchSize) {
      const batch = rules.slice(i, i + batchSize);
      const rows = batch.map(r => ({
        rule_id: r.ruleId,
        stig_id: r.stigId,
        title: r.title,
        description: r.description,
        check_text: r.checkText,
        fix_text: r.fixText,
        category: r.category,
        disruption: r.disruption,
        scanner: r.scanner,
        updated_at: now,
      }));
      await this.db('compliance_rule_metadata')
        .insert(rows)
        .onConflict('rule_id')
        .merge(['stig_id', 'title', 'description', 'check_text', 'fix_text', 'category', 'disruption', 'scanner', 'updated_at']);
    }

    return rules.length;
  }

  async getRuleMetadataBulk(ruleIds: string[]): Promise<Map<string, RuleMetadataRecord>> {
    if (ruleIds.length === 0) return new Map();

    const rows = await this.db('compliance_rule_metadata')
      .whereIn('rule_id', ruleIds);

    const map = new Map<string, RuleMetadataRecord>();
    for (const row of rows) {
      map.set(row.rule_id as string, this.mapRuleMetadataRow(row));
    }
    return map;
  }

  async getAllRuleMetadata(): Promise<Map<string, RuleMetadataRecord>> {
    const rows = await this.db('compliance_rule_metadata');
    const map = new Map<string, RuleMetadataRecord>();
    for (const row of rows) {
      map.set(row.rule_id as string, this.mapRuleMetadataRow(row));
    }
    return map;
  }

  private mapRuleMetadataRow(row: Record<string, unknown>): RuleMetadataRecord {
    return {
      ruleId: row.rule_id as string,
      stigId: (row.stig_id as string) || '',
      title: (row.title as string) || '',
      description: (row.description as string) || '',
      checkText: (row.check_text as string) || '',
      fixText: (row.fix_text as string) || '',
      category: (row.category as string) || '',
      disruption: ((row.disruption as string) || 'medium') as 'low' | 'medium' | 'high',
      scanner: (row.scanner as string) || '',
      updatedAt: toISOString(row.updated_at),
    };
  }

  // ─── Profile registry ────────────────────────────────────────────

  async listProfiles(): Promise<ComplianceProfile[]> {
    const rows = await this.db('compliance_profile_registry')
      .orderBy('created_at', 'desc');
    return rows.map(this.mapProfileRow);
  }

  async getProfile(id: string): Promise<ComplianceProfile | null> {
    const row = await this.db('compliance_profile_registry')
      .where('id', id)
      .first();
    if (!row) return null;
    return this.mapProfileRow(row);
  }

  async saveProfile(profile: SaveProfileRequest, ruleCount?: number): Promise<ComplianceProfile> {
    const now = new Date().toISOString();
    const id = profile.id || randomUUID();

    const row: Record<string, unknown> = {
      id,
      display_name: profile.displayName,
      description: profile.description || '',
      framework: profile.framework,
      version: profile.version || '',
      platform: profile.platform || '',
      platform_spec: profile.platformSpec ? JSON.stringify(profile.platformSpec) : null,
      certification: profile.certification ? JSON.stringify(profile.certification) : null,
      workflow_template_id: profile.workflowTemplateId,
      remediate_jt_id: profile.remediateJtId ?? null,
      ee_id: profile.eeId,
      remediation_playbook_path: profile.remediationPlaybookPath || '',
      scan_tags: profile.scanTags || '',
      updated_at: now,
    };
    if (ruleCount !== undefined) {
      row.rule_count = ruleCount;
    }

    const existing = await this.db('compliance_profile_registry')
      .where('id', id)
      .first();

    if (existing) {
      await this.db('compliance_profile_registry')
        .where('id', id)
        .update(row);
    } else {
      await this.db('compliance_profile_registry').insert({
        ...row,
        created_at: now,
      });
    }

    return this.mapProfileRow({
      ...row,
      created_at: existing ? existing.created_at : now,
    });
  }

  async deleteProfile(id: string): Promise<boolean> {
    const deleted = await this.db('compliance_profile_registry')
      .where('id', id)
      .delete();
    return deleted > 0;
  }

  async updateProfileRuleCount(id: string, ruleCount: number): Promise<void> {
    await this.db('compliance_profile_registry')
      .where('id', id)
      .update({ rule_count: ruleCount });
  }

  private mapProfileRow(row: Record<string, unknown>): ComplianceProfile {
    return {
      id: row.id as string,
      displayName: row.display_name as string,
      description: (row.description as string) || '',
      framework: row.framework as string,
      version: (row.version as string) || '',
      platform: (row.platform as string) || '',
      platformSpec: safeJsonParse(row.platform_spec),
      workflowTemplateId: (row.workflow_template_id as number) ?? null,
      remediateJtId: (row.remediate_jt_id as number) ?? null,
      eeId: (row.ee_id as number) ?? null,
      remediationPlaybookPath: (row.remediation_playbook_path as string) || '',
      scanTags: (row.scan_tags as string) || '',
      certification: safeJsonParse(row.certification),
      ruleCount: (row.rule_count as number) ?? undefined,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
    };
  }
}

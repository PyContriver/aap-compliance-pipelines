/**
 * Knex-based data access layer for compliance plugin persistence.
 */
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

import type {
  ComplianceScan,
  StoredFinding,
  PostureSnapshot,
  RemediationProfile,
  RemediationSelection,
  ComplianceCartridge,
  SaveCartridgeRequest,
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

  async getRecentScans(limit: number = 10): Promise<ComplianceScan[]> {
    const rows = await this.db('compliance_scans')
      .orderBy('started_at', 'desc')
      .limit(limit);
    return rows.map(this.mapScanRow);
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
    };
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
      scanId?: string;
      selections: RemediationSelection[];
    },
  ): Promise<{ id: string }> {
    const now = new Date().toISOString();

    if (profile.id) {
      await this.db('compliance_remediation_profiles')
        .where('id', profile.id)
        .update({
          name: profile.name,
          description: profile.description,
          scan_id: profile.scanId ?? null,
          selections_json: JSON.stringify(profile.selections),
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
      scan_id: profile.scanId ?? null,
      selections_json: JSON.stringify(profile.selections),
      created_at: now,
      updated_at: now,
    });
    return { id };
  }

  async listRemediationProfiles(): Promise<RemediationProfile[]> {
    const rows = await this.db('compliance_remediation_profiles')
      .orderBy('created_at', 'desc');
    return rows.map(this.mapRemediationProfileRow);
  }

  async getRemediationProfile(id: string): Promise<RemediationProfile | null> {
    const row = await this.db('compliance_remediation_profiles')
      .where('id', id)
      .first();
    if (!row) return null;
    return this.mapRemediationProfileRow(row);
  }

  async deleteRemediationProfile(id: string): Promise<boolean> {
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
      scanId: (row.scan_id as string) || undefined,
      targetInventory: '',
      selections,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
    };
  }

  // ─── Cartridge registry ────────────────────────────────────────────

  async listCartridges(): Promise<ComplianceCartridge[]> {
    const rows = await this.db('compliance_cartridge_registry')
      .orderBy('created_at', 'desc');
    return rows.map(this.mapCartridgeRow);
  }

  async getCartridge(id: string): Promise<ComplianceCartridge | null> {
    const row = await this.db('compliance_cartridge_registry')
      .where('id', id)
      .first();
    if (!row) return null;
    return this.mapCartridgeRow(row);
  }

  async saveCartridge(cartridge: SaveCartridgeRequest): Promise<ComplianceCartridge> {
    const now = new Date().toISOString();
    const id = cartridge.id || randomUUID();

    const row = {
      id,
      display_name: cartridge.displayName,
      description: cartridge.description || '',
      framework: cartridge.framework,
      version: cartridge.version || '',
      platform: cartridge.platform || '',
      workflow_template_id: cartridge.workflowTemplateId,
      ee_id: cartridge.eeId,
      remediation_playbook_path: cartridge.remediationPlaybookPath || '',
      scan_tags: cartridge.scanTags || '',
      updated_at: now,
    };

    const existing = await this.db('compliance_cartridge_registry')
      .where('id', id)
      .first();

    if (existing) {
      await this.db('compliance_cartridge_registry')
        .where('id', id)
        .update(row);
    } else {
      await this.db('compliance_cartridge_registry').insert({
        ...row,
        created_at: now,
      });
    }

    return this.mapCartridgeRow({
      ...row,
      created_at: existing ? existing.created_at : now,
    });
  }

  async deleteCartridge(id: string): Promise<boolean> {
    const deleted = await this.db('compliance_cartridge_registry')
      .where('id', id)
      .delete();
    return deleted > 0;
  }

  private mapCartridgeRow(row: Record<string, unknown>): ComplianceCartridge {
    return {
      id: row.id as string,
      displayName: row.display_name as string,
      description: (row.description as string) || '',
      framework: row.framework as string,
      version: (row.version as string) || '',
      platform: (row.platform as string) || '',
      workflowTemplateId: (row.workflow_template_id as number) ?? null,
      eeId: (row.ee_id as number) ?? null,
      remediationPlaybookPath: (row.remediation_playbook_path as string) || '',
      scanTags: (row.scan_tags as string) || '',
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at),
    };
  }
}

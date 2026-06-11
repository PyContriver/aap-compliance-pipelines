import { detectEvents, buildMultiProfileSeries } from './trendUtils';
import type { PostureSnapshot } from '@aap-compliance/common';

function snap(overrides: Partial<PostureSnapshot> & { compliancePct: number; timestamp: string }): PostureSnapshot {
  return {
    id: `snap-${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'prof-1',
    totalHosts: 10,
    totalRules: 100,
    passCount: Math.round(overrides.compliancePct),
    failCount: 100 - Math.round(overrides.compliancePct),
    ...overrides,
  };
}

describe('detectEvents', () => {
  it('marks first point as normal with zero delta', () => {
    const result = detectEvents([snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' })]);
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe('normal');
    expect(result[0].delta).toBe(0);
  });

  it('detects regression when score drops >= 3pp', () => {
    const result = detectEvents([
      snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 77, timestamp: '2026-06-02T00:00:00Z' }),
    ]);
    expect(result[1].eventType).toBe('regression');
    expect(result[1].delta).toBe(-3);
  });

  it('detects regression at exactly -3pp threshold', () => {
    const result = detectEvents([
      snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 77, timestamp: '2026-06-02T00:00:00Z' }),
    ]);
    expect(result[1].eventType).toBe('regression');
  });

  it('does NOT flag regression at -2pp (below threshold)', () => {
    const result = detectEvents([
      snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 78, timestamp: '2026-06-02T00:00:00Z' }),
    ]);
    expect(result[1].eventType).toBe('normal');
  });

  it('detects improvement when score improves >= 5pp', () => {
    const result = detectEvents([
      snap({ compliancePct: 70, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 75, timestamp: '2026-06-02T00:00:00Z' }),
    ]);
    expect(result[1].eventType).toBe('improvement');
    expect(result[1].delta).toBe(5);
  });

  it('does NOT flag improvement at +4pp (below threshold)', () => {
    const result = detectEvents([
      snap({ compliancePct: 70, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 74, timestamp: '2026-06-02T00:00:00Z' }),
    ]);
    expect(result[1].eventType).toBe('normal');
  });

  it('handles alternating ups and downs', () => {
    const result = detectEvents([
      snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ compliancePct: 70, timestamp: '2026-06-02T00:00:00Z' }),
      snap({ compliancePct: 85, timestamp: '2026-06-03T00:00:00Z' }),
      snap({ compliancePct: 80, timestamp: '2026-06-04T00:00:00Z' }),
    ]);
    expect(result[0].eventType).toBe('normal');
    expect(result[1].eventType).toBe('regression');
    expect(result[2].eventType).toBe('improvement');
    expect(result[3].eventType).toBe('regression'); // 85→80 = -5pp
  });

  it('returns empty array for empty input', () => {
    expect(detectEvents([])).toEqual([]);
  });

  it('converts timestamps to epoch milliseconds', () => {
    const result = detectEvents([snap({ compliancePct: 80, timestamp: '2026-06-01T12:00:00Z' })]);
    expect(result[0].timestamp).toBe(new Date('2026-06-01T12:00:00Z').getTime());
  });

  it('preserves scanId for navigation', () => {
    const result = detectEvents([
      snap({ compliancePct: 80, timestamp: '2026-06-01T00:00:00Z', scanId: 'scan-abc' }),
    ]);
    expect(result[0].scanId).toBe('scan-abc');
  });
});

describe('buildMultiProfileSeries', () => {
  const profileMap = new Map([
    ['prof-stig', 'DISA STIG'],
    ['prof-cis', 'CIS L1'],
  ]);

  it('groups snapshots by profileId', () => {
    const snapshots = [
      snap({ profileId: 'prof-stig', compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ profileId: 'prof-cis', compliancePct: 90, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ profileId: 'prof-stig', compliancePct: 85, timestamp: '2026-06-02T00:00:00Z' }),
    ];
    const { data, profileIds } = buildMultiProfileSeries(snapshots, profileMap);
    expect(profileIds).toContain('prof-stig');
    expect(profileIds).toContain('prof-cis');
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  it('fills forward last known value for profiles without data at a timestamp', () => {
    const snapshots = [
      snap({ profileId: 'prof-stig', compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ profileId: 'prof-cis', compliancePct: 90, timestamp: '2026-06-02T00:00:00Z' }),
      snap({ profileId: 'prof-stig', compliancePct: 85, timestamp: '2026-06-03T00:00:00Z' }),
    ];
    const { data } = buildMultiProfileSeries(snapshots, profileMap);
    const lastRow = data[data.length - 1];
    expect(lastRow['prof-stig']).toBe(85);
    expect(lastRow['prof-cis']).toBe(90);
  });

  it('returns empty data for no matching profiles', () => {
    const { data, profileIds } = buildMultiProfileSeries(
      [snap({ profileId: 'unknown', compliancePct: 50, timestamp: '2026-06-01T00:00:00Z' })],
      profileMap,
    );
    expect(data).toEqual([]);
    expect(profileIds).toEqual([]);
  });

  it('handles single profile', () => {
    const snapshots = [
      snap({ profileId: 'prof-stig', compliancePct: 80, timestamp: '2026-06-01T00:00:00Z' }),
      snap({ profileId: 'prof-stig', compliancePct: 85, timestamp: '2026-06-02T00:00:00Z' }),
    ];
    const { data, profileIds } = buildMultiProfileSeries(snapshots, profileMap);
    expect(profileIds).toEqual(['prof-stig']);
    expect(data).toHaveLength(2);
    expect(data[0]['prof-stig']).toBe(80);
    expect(data[1]['prof-stig']).toBe(85);
  });

  it('handles empty input', () => {
    const { data, profileIds } = buildMultiProfileSeries([], profileMap);
    expect(data).toEqual([]);
    expect(profileIds).toEqual([]);
  });
});

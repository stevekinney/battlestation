import { describe, expect, it } from 'bun:test';

import { diagnose, repairToml } from './doctor.js';

describe('diagnose', () => {
  it('reports a healthy document', () => {
    const diagnosis = diagnose('[dock]\nicon-size = 48\n');

    expect(diagnosis.healthy).toBe(true);
    expect(diagnosis.fixable).toBe(true);
    expect(diagnosis.setCount).toBe(1);
  });

  it('marks unknown sections and keys as fixable', () => {
    const diagnosis = diagnose('[nonsense]\nfoo = 1\n\n[dock]\nbogus = 2\nicon-size = 48\n');

    expect(diagnosis.healthy).toBe(false);
    expect(diagnosis.fixable).toBe(true);
    expect(diagnosis.analysis.issues.map((issue) => issue.message)).toEqual([
      'Unknown section [nonsense]',
      'Unknown setting dock.bogus',
    ]);
    expect(diagnosis.setCount).toBe(1);
  });

  it('marks type mismatches and malformed sections as manual', () => {
    const diagnosis = diagnose('dock = 1\n\n[finder]\nshow-path-bar = "yes"\n');

    expect(diagnosis.fixable).toBe(false);
    expect(diagnosis.analysis.issues).toEqual([
      {
        kind: 'not-a-table',
        message: '[dock] must be a table of settings',
        fixable: false,
        severity: 'error',
      },
      {
        kind: 'wrong-type',
        message: 'finder.show-path-bar must be true or false',
        fixable: false,
        severity: 'error',
      },
    ]);
  });

  it('marks syntax errors as manual', () => {
    const diagnosis = diagnose('[dock\nicon-size = 48\n');

    expect(diagnosis.fixable).toBe(false);
    expect(diagnosis.analysis.issues[0]!.kind).toBe('syntax');
  });
});

describe('warnings', () => {
  it('separates advisory warnings from blocking errors', () => {
    const diagnosis = diagnose('[dock]\nbogus = 1\nicon-size = 4096\n');

    expect(diagnosis.errors.map((issue) => issue.kind)).toEqual(['unknown-key']);
    expect(diagnosis.warnings.map((issue) => issue.kind)).toEqual(['out-of-domain']);
    expect(diagnosis.healthy).toBe(false);
    expect(diagnosis.fixable).toBe(true);
  });

  it('is unhealthy but fixable-free with only warnings', () => {
    const diagnosis = diagnose('[dock]\nicon-size = 4096\n');

    expect(diagnosis.errors).toEqual([]);
    expect(diagnosis.warnings).toHaveLength(1);
    expect(diagnosis.healthy).toBe(false);
  });
});

describe('repairToml', () => {
  it('drops unknown entries, keeps valid settings, and preserves the header', () => {
    const text =
      '# my snapshot\n# second line\n\n[nonsense]\nfoo = 1\n\n[dock]\nicon-size = 48\nbogus = 2\n';
    const repaired = repairToml(text, diagnose(text));

    expect(repaired).toStartWith('# my snapshot\n# second line\n');
    expect(repaired).toContain('icon-size = 48');
    expect(repaired).not.toContain('nonsense');
    expect(repaired).not.toContain('bogus');
    expect(repaired).toContain('# auto-hide is not set; macOS uses its built-in default.');
  });
});

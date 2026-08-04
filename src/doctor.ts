import { registry } from './settings/registry.js';
import type { TomlAnalysis, TomlIssue } from './toml.js';
import { analyzeToml, extractHeader, renderToml } from './toml.js';

/** The result of examining a battlestation TOML document. */
export type Diagnosis = {
  analysis: TomlAnalysis;
  /** Issues that block applying the document. */
  errors: TomlIssue[];
  /** Advisory issues: values outside their known domain. */
  warnings: TomlIssue[];
  /** True when the document has no errors and no warnings. */
  healthy: boolean;
  /** True when every error can be repaired by dropping the offending entry. */
  fixable: boolean;
  /** How many registry settings the document sets. */
  setCount: number;
};

/** Examine a TOML document for syntax, schema, type, and domain problems. */
export function diagnose(text: string): Diagnosis {
  const analysis = analyzeToml(text);
  const errors = analysis.issues.filter((issue) => issue.severity === 'error');
  const warnings = analysis.issues.filter((issue) => issue.severity === 'warning');

  return {
    analysis,
    errors,
    warnings,
    healthy: analysis.issues.length === 0,
    fixable: errors.every((issue) => issue.fixable),
    setCount: analysis.desired.length,
  };
}

/**
 * Rewrite a TOML document in canonical annotated form, keeping only valid
 * settings — unknown sections and keys are dropped, every remaining setting
 * gets its documentation comment back, and the original header is preserved.
 */
export function repairToml(text: string, diagnosis: Diagnosis): string {
  const values = new Map(
    diagnosis.analysis.desired.map((entry) => [entry.definition, entry.value]),
  );

  return renderToml(
    registry.map((definition) => ({ definition, value: values.get(definition) })),
    extractHeader(text),
  );
}

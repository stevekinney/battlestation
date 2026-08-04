import { z } from 'zod';

/**
 * Schema for the environment variables this package reads.
 *
 * Add new variables here as your project grows, then document them in
 * `.env.example`. Keeping the schema as the single source of truth means a
 * missing or malformed variable fails fast at startup instead of surfacing as
 * an `undefined` somewhere deep in your code.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
});

/** The shape of the validated environment. */
export type Environment = z.infer<typeof environmentSchema>;

/**
 * Parse and validate the given environment record against {@link environmentSchema}.
 *
 * Exposed separately from {@link environment} so tests can validate arbitrary
 * inputs without mutating `process.env`.
 *
 * @param source - The raw environment record to validate. Defaults to `process.env`.
 * @returns The validated, typed environment.
 * @throws {z.ZodError} If `source` does not satisfy the schema.
 */
export function parseEnvironment(
  source: Record<string, string | undefined> = process.env,
): Environment {
  return environmentSchema.parse(source);
}

/**
 * The validated environment, parsed once from `process.env` at module load.
 *
 * This is the single source of truth for configuration throughout the package.
 */
export const environment: Environment = parseEnvironment();

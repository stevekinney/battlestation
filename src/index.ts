export { environment, parseEnvironment, type Environment } from './environment.js';

/**
 * Greet someone by name.
 *
 * This is a placeholder for your library's public API — replace it with your
 * own exports. It exists so the package has a real, tested surface area out of
 * the box rather than an empty module.
 *
 * @param name - The name to greet.
 * @returns A friendly greeting.
 */
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

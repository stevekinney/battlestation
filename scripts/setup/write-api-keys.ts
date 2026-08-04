#!/usr/bin/env bun
import path from 'node:path';

import chalk from 'chalk';

const setupDir = import.meta.dir;
const projectRoot = path.dirname(path.dirname(setupDir));
const envPath = path.join(projectRoot, '.env');

type KeySpec = {
  key: string;
  envVar: string;
};

// Canonical names the official SDKs read from the environment, so a key copied
// here is picked up automatically by the OpenAI, Anthropic, and Google clients.
const KEYS: KeySpec[] = [
  { key: 'OPENAI_API_KEY', envVar: 'OPENAI_API_KEY' },
  { key: 'ANTHROPIC_API_KEY', envVar: 'ANTHROPIC_API_KEY' },
  { key: 'GEMINI_API_KEY', envVar: 'GEMINI_API_KEY' },
];

const PLACEHOLDER_VALUES = new Set(['', 'changeme', 'your-key-here', 'replace-me']);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function parseEnvironment(contents: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k, ...rest] = trimmed.split('=');
    if (!k) continue;
    map.set(k.trim(), rest.join('='));
  }
  return map;
}

function serializeEnvironment(map: Map<string, string>, original: string): string {
  const lines = original.split('\n');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      out.push(raw);
      continue;
    }
    const [k] = line.split('=');
    const trimmedKey = k?.trim();
    if (trimmedKey && map.has(trimmedKey)) {
      out.push(`${trimmedKey}=${map.get(trimmedKey) ?? ''}`);
      seen.add(trimmedKey);
    } else {
      out.push(raw);
    }
  }
  for (const [k, v] of map.entries()) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  return out.join('\n').replace(/\n*$/, '\n');
}

try {
  let envRaw = '';
  try {
    envRaw = await Bun.file(envPath).text();
  } catch {
    envRaw = '';
  }
  const map = parseEnvironment(envRaw);
  const written: string[] = [];

  for (const { key, envVar } of KEYS) {
    const shellVal = process.env[envVar];
    if (!shellVal?.length) continue;
    const existing = map.get(key);
    // Only overwrite if the current value is absent or a placeholder.
    if (existing !== undefined && !isPlaceholder(existing)) continue;
    map.set(key, shellVal);
    written.push(key);
  }

  if (written.length > 0) {
    const next = serializeEnvironment(map, envRaw);
    await Bun.write(envPath, next);
    // Name each key so it's clear which real credentials were materialized on disk.
    for (const key of written) {
      console.log(chalk.green(`Wrote ${key} to .env (from $${key}).`));
    }
  } else {
    console.log(chalk.gray('No API keys written (values already set or shell env empty).'));
  }
} catch (err) {
  console.error(chalk.red('Failed to write API keys to .env:'), err);
  process.exit(1);
}

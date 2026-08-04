import { afterAll, describe, expect, it } from 'bun:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { z } from 'zod';

import { makeEnvironment } from '../test/cli-helpers.js';
import { closeMcpServer, createMcpServer, logToStderr } from './mcp.js';

const textResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string() })),
});

const jsonArraySchema = z.array(z.record(z.string(), z.unknown()));

async function connectedClient(files: Map<string, string>): Promise<Client> {
  const { environment } = makeEnvironment(files);
  const server = createMcpServer(environment);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return client;
}

function text(result: unknown): string {
  return textResultSchema
    .parse(result)
    .content.map((block) => block.text)
    .join('\n');
}

describe('createMcpServer', () => {
  const files = new Map([['battlestation.toml', '[dock]\nauto-hide = true\nicon-size = 48\n']]);

  it('exposes every battlestation capability as a tool', async () => {
    const client = await connectedClient(new Map(files));
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual([
      'apply',
      'capture',
      'diff',
      'doctor',
      'get_setting',
      'list_settings',
      'set_setting',
      'unset_setting',
    ]);
    await client.close();
  });

  it('diff returns machine-readable changes', async () => {
    const client = await connectedClient(new Map(files));
    const result = await client.callTool({ name: 'diff', arguments: {} });

    const changes = jsonArraySchema.parse(JSON.parse(text(result)));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ address: 'dock.icon-size', current: null, target: 48 });
    await client.close();
  });

  it('apply with dryRun previews without applying', async () => {
    const client = await connectedClient(new Map(files));
    const result = await client.callTool({ name: 'apply', arguments: { dryRun: true } });

    expect(JSON.parse(text(result))).toMatchObject({ applied: false });
    await client.close();
  });

  it('apply runs without a confirmation prompt and reports the undo file', async () => {
    const workingFiles = new Map(files);
    const client = await connectedClient(workingFiles);
    const result = await client.callTool({ name: 'apply', arguments: {} });

    expect(JSON.parse(text(result))).toMatchObject({
      applied: true,
      undoFile: 'battlestation.undo.toml',
    });
    expect(workingFiles.has('battlestation.undo.toml')).toBe(true);
    await client.close();
  });

  it('capture writes the TOML file', async () => {
    const workingFiles = new Map<string, string>();
    const client = await connectedClient(workingFiles);
    const result = await client.callTool({ name: 'capture', arguments: { file: 'out.toml' } });

    expect(text(result)).toContain('Captured system settings to out.toml.');
    expect(workingFiles.get('out.toml')).toContain('auto-hide = true');
    await client.close();
  });

  it('doctor reports health and set_setting/get_setting/unset_setting edit the file', async () => {
    const workingFiles = new Map(files);
    const client = await connectedClient(workingFiles);

    const doctor = await client.callTool({ name: 'doctor', arguments: {} });
    expect(text(doctor)).toContain('is healthy');

    const set = await client.callTool({
      name: 'set_setting',
      arguments: { address: 'dock.icon-size', value: '64' },
    });
    expect(text(set)).toContain('Set dock.icon-size = 64');
    expect(workingFiles.get('battlestation.toml')).toContain('icon-size = 64');

    const get = await client.callTool({
      name: 'get_setting',
      arguments: { address: 'dock.icon-size' },
    });
    expect(JSON.parse(text(get))).toMatchObject({ address: 'dock.icon-size', file: 64 });

    const unset = await client.callTool({
      name: 'unset_setting',
      arguments: { address: 'dock.icon-size' },
    });
    expect(text(unset)).toContain('Unset dock.icon-size');
    expect(workingFiles.get('battlestation.toml')).not.toContain('icon-size = 64');

    const list = await client.callTool({ name: 'list_settings', arguments: {} });
    const reports = jsonArraySchema.parse(JSON.parse(text(list)));
    expect(reports.length).toBeGreaterThan(100);
    await client.close();
  });

  it('marks failed commands as errors', async () => {
    const client = await connectedClient(new Map(files));
    const result = await client.callTool({
      name: 'get_setting',
      arguments: { address: 'dock.nope' },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Unknown setting "dock.nope".');
    await client.close();
  });
});

describe('closeMcpServer', () => {
  afterAll(async () => {
    await closeMcpServer();
  });

  it('is a no-op when no server is running', async () => {
    await closeMcpServer();
  });

  it('writes diagnostics to stderr, keeping stdout for the protocol', () => {
    expect(() => logToStderr('diagnostic')).not.toThrow();
  });
});

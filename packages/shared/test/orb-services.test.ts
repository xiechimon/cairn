import { describe, expect, it } from 'vitest';
import { orbServicesFileSchema } from '../src/index.js';

const ampWebExample = {
  services: {
    web: {
      command: 'pnpm dev -- --host 0.0.0.0 --port "$PORT"',
      cwd: 'app',
      health: '/healthz',
      env: { API_MODE: 'development' },
      review: true,
      agent: 'observe',
      portal: {
        url: '/',
        title: 'App',
        description: 'Use the seeded development account.',
      },
      portals: [
        {
          url: '/admin',
          title: 'Admin',
          description: 'Open the administration tools.',
        },
      ],
    },
  },
};

const ampSimulatorExample = {
  services: {
    simulator: {
      platforms: ['darwin'],
      command: './scripts/serve-ios-simulator',
      portal: true,
    },
  },
};

const ampHealthExample = {
  services: {
    web: {
      command: 'pnpm dev -- --host 0.0.0.0 --port "$PORT"',
      health: '/healthz',
      portal: true,
    },
  },
};

const ampGroupedPortalsExample = {
  services: {
    web: {
      command: 'pnpm dev',
      portal: true,
      portals: [
        {
          folder: 'Marketing site',
          links: [
            { url: '/home', title: 'Homepage' },
            { url: '/pricing', title: 'Pricing' },
          ],
        },
        { url: '/storybook', title: 'Storybook' },
      ],
    },
  },
};

function publicUrlRef(name: string): string {
  return `\${services.${name}.publicURL}`;
}

describe('orbServicesFileSchema (#2280)', () => {
  it('parses the Amp portals doc web, simulator, health, and grouped-link examples', () => {
    const web = orbServicesFileSchema.parse(ampWebExample).services.web;
    const simulator = orbServicesFileSchema.parse(ampSimulatorExample).services.simulator;
    const health = orbServicesFileSchema.parse(ampHealthExample).services.web;
    const grouped = orbServicesFileSchema.parse(ampGroupedPortalsExample).services.web;
    expect(web?.command).toContain('pnpm dev');
    expect(web?.agent).toBe('observe');
    expect(simulator?.portal).toBe(true);
    expect(health?.health).toBe('/healthz');
    expect(grouped?.portals).toHaveLength(2);
  });

  it('accepts agent off, observe, and control', () => {
    for (const agent of ['off', 'observe', 'control'] as const) {
      const parsed = orbServicesFileSchema.parse({
        services: { web: { command: './serve', agent } },
      });
      expect(parsed.services.web?.agent).toBe(agent);
    }
  });

  it('accepts a 32-character lowercase name, linux platforms, and https portal URLs', () => {
    const name = `a${'b'.repeat(31)}`;
    const parsed = orbServicesFileSchema.parse({
      services: {
        [name]: {
          command: './serve',
          platforms: ['linux'],
          portal: { url: 'https://example.test/app', title: 'App' },
        },
      },
    });
    expect(parsed.services[name]?.command).toBe('./serve');
  });

  it('rejects an empty services mapping', () => {
    expect(orbServicesFileSchema.safeParse({ services: {} }).success).toBe(false);
  });

  it('rejects a 33-character service name', () => {
    const name = `a${'b'.repeat(32)}`;
    expect(
      orbServicesFileSchema.safeParse({
        services: { [name]: { command: './serve' } },
      }).success,
    ).toBe(false);
  });

  it('rejects platforms: []', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', platforms: [] } },
      }).success,
    ).toBe(false);
  });

  it('rejects cwd that escapes the repository', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', cwd: '../outside' } },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', cwd: 'app/../../outside' } },
      }).success,
    ).toBe(false);
  });

  it('rejects an absolute cwd', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', cwd: '/tmp' } },
      }).success,
    ).toBe(false);
  });

  it('rejects env that sets PORT', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: { command: './serve', env: { PORT: '3000', API_MODE: 'dev' } },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing command', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { portal: true } },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown agent value', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', agent: 'write' } },
      }).success,
    ).toBe(false);
  });

  it('accepts an env publicURL reference to a portal service', () => {
    const parsed = orbServicesFileSchema.parse({
      services: {
        api: { command: './api', portal: true },
        web: {
          command: './web',
          portal: true,
          env: { API_URL: publicUrlRef('api') },
        },
      },
    });
    expect(parsed.services.web?.env?.API_URL).toBe(publicUrlRef('api'));
  });

  it('rejects an env publicURL reference to a missing service', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: {
            command: './web',
            env: { API_URL: publicUrlRef('api') },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an env publicURL reference to a service without a portal', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          api: { command: './api' },
          web: {
            command: './web',
            env: { API_URL: publicUrlRef('api') },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a cyclic env publicURL reference', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          api: {
            command: './api',
            portal: true,
            env: { WEB_URL: publicUrlRef('web') },
          },
          web: {
            command: './web',
            portal: true,
            env: { API_URL: publicUrlRef('api') },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed env publicURL service name', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: {
            command: './web',
            env: { API_URL: publicUrlRef('API') },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: {
            command: './web',
            env: { API_URL: publicUrlRef(`a${'b'.repeat(32)}`) },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an env publicURL reference across incompatible platforms', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          api: { command: './api', portal: true, platforms: ['darwin'] },
          web: {
            command: './web',
            platforms: ['linux'],
            env: { API_URL: publicUrlRef('api') },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported portal URL forms', () => {
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', portal: { url: 'admin' } } },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: {
            command: './serve',
            portals: [{ url: 'ftp://example.com', title: 'Files' }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', portal: { url: 'https://' } } },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: {
          web: {
            command: './serve',
            portals: [{ url: 'http://?x', title: 'Broken' }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      orbServicesFileSchema.safeParse({
        services: { web: { command: './serve', portal: { url: '/\\evil.example/path' } } },
      }).success,
    ).toBe(false);
  });
});

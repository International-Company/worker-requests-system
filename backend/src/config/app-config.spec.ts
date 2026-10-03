import { loadConfig } from './app-config';
import { PinService } from '../common/security/pin.service';

const env = { AUTH_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://localhost/db' };

describe('loadConfig', () => {
  it('requires a strong AUTH_SECRET and a DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x' })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...env, AUTH_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ AUTH_SECRET: env.AUTH_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('requires HTTPS APP_URL in production and secures cookies there', () => {
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', APP_URL: 'http://x.app' })).toThrow(/https/);
    const c = loadConfig({ ...env, NODE_ENV: 'production', APP_URL: 'https://x.app/' });
    expect(c).toMatchObject({ appUrl: 'https://x.app', cookieSecure: true, trustProxy: true, vapid: null });
  });
});

describe('PinService', () => {
  const pins = new PinService(loadConfig(env));

  it('is deterministic (lookup) and keyed (not a plain hash of the PIN)', () => {
    expect(pins.hash('1234')).toBe(pins.hash('1234'));
    expect(pins.hash('1234')).not.toBe(pins.hash('1235'));
    const other = new PinService(loadConfig({ ...env, AUTH_SECRET: 'y'.repeat(40) }));
    expect(other.hash('1234')).not.toBe(pins.hash('1234'));
  });

  it('only accepts exactly 4 digits', () => {
    for (const bad of ['123', '12345', 'abcd', '12 4', '']) expect(() => pins.hash(bad)).toThrow();
  });

  it('session token hashes are domain-separated from PIN hashes', () => {
    expect(pins.hashSessionToken('1234')).not.toBe(pins.hash('1234'));
  });
});

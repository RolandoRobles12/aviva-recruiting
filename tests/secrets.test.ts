// Every deployed function must receive every secret. A function that sets its
// own `secrets` option replaces the global list instead of extending it, and a
// v1 function ignores setGlobalOptions altogether — both would fail at runtime
// with "secret not declared" the first time they touch a credential.

import { describe, expect, it } from 'vitest';
import { ALL_SECRETS } from '../functions/src/utils/secrets';

// The storage trigger needs a bucket name at definition time; any will do.
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: 'demo-test', storageBucket: 'demo-test.appspot.com' });
process.env.GCLOUD_PROJECT ??= 'demo-test';
const functionsIndex = await import('../functions/src/index');

describe('secrets', () => {
  const expected = ALL_SECRETS.map((secret) => secret.name).sort();
  const exported = Object.entries(functionsIndex).filter(
    ([, value]) => typeof value === 'function' && '__endpoint' in (value as object)
  ) as [string, { __endpoint: { secretEnvironmentVariables?: { key: string }[] } }][];

  it('finds the deployed functions', () => {
    expect(exported.length).toBeGreaterThan(30);
  });

  it.each(exported.map(([name, fn]) => [name, fn] as const))('%s receives every secret', (_name, fn) => {
    const declared = (fn.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key).sort();
    expect(declared).toEqual(expected);
  });
});

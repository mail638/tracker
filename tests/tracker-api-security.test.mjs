import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTrackerAuth, handleTrackerState } from '../lib/tracker-api.ts';

const config = {
  supabaseUrl: 'https://project.supabase.co',
  serviceRoleKey: 'server-only-service-role-secret',
  ownerId: 'tracker-owner-uuid',
  accessPassword: 'a-long-test-password-that-is-over-32-characters',
  sessionSecret: 'a-session-secret-that-is-at-least-32-bytes',
};

async function login() {
  const response = await handleTrackerAuth(
    new Request('https://tracker.example/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://tracker.example' },
      body: JSON.stringify({ password: config.accessPassword }),
    }),
    config,
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';', 1)[0];
}

test('unauthenticated GET cannot read tracker state or contact Supabase', async () => {
  let calls = 0;
  const response = await handleTrackerState(
    new Request('https://tracker.example/api/tracker-state'),
    config,
    async () => {
      calls += 1;
      return Response.json([{ state: { wealth: [{ total: 999 }] } }]);
    },
  );
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('unauthenticated PUT cannot overwrite tracker state or contact Supabase', async () => {
  let calls = 0;
  const response = await handleTrackerState(
    new Request('https://tracker.example/api/tracker-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://tracker.example' },
      body: JSON.stringify({ wealth: [] }),
    }),
    config,
    async () => {
      calls += 1;
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('invalid and tampered session cookies cannot read or write', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(null, { status: 201 });
  };
  for (const method of ['GET', 'PUT']) {
    const request = new Request('https://tracker.example/api/tracker-state', {
      method,
      headers: {
        Cookie: 'tracker_session=v1.1800003600.invalidsignature',
        Origin: 'https://tracker.example',
        'Content-Type': 'application/json',
      },
      ...(method === 'PUT' ? { body: '{}' } : {}),
    });
    const response = await handleTrackerState(request, config, fetcher);
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test('valid password establishes a signed session accepted by the API', async () => {
  const cookie = await login();
  let requestedUrl = '';
  const response = await handleTrackerState(
    new Request('https://tracker.example/api/tracker-state', {
      headers: { Cookie: cookie },
    }),
    config,
    async (url) => {
      requestedUrl = String(url);
      return Response.json([{ state: { wealth: [{ total: 12 }] }, updated_at: '2026-10-22T12:00:00Z' }]);
    },
  );
  assert.equal(response.status, 200);
  assert.match(requestedUrl, /owner_id=eq\.tracker-owner-uuid/);
  assert.deepEqual((await response.json()).state.wealth, [{ total: 12 }]);
});

test('authenticated PUT writes only to the configured owner row', async () => {
  const cookie = await login();
  let saved = null;
  const response = await handleTrackerState(
    new Request('https://tracker.example/api/tracker-state', {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        Origin: 'https://tracker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ goals: { focus: 'health' } }),
    }),
    config,
    async (_url, init) => {
      saved = JSON.parse(String(init?.body));
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(saved.owner_id, config.ownerId);
  assert.deepEqual(saved.state.goals, { focus: 'health' });
});

test('cross-origin write requests are rejected', async () => {
  const cookie = await login();
  let calls = 0;
  const response = await handleTrackerState(
    new Request('https://tracker.example/api/tracker-state', {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: '{}',
    }),
    config,
    async () => {
      calls += 1;
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

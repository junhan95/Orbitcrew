import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { headersContextFromRequest, runWithHeadersContext, applyMiddlewareRequestHeaders } from '../node_modules/vinext/dist/shims/headers.js';
import { proxy } from '@/proxy';
import { makeState, findSessionUser } from '@/lib/auth';
import { GET as callback } from '@/app/api/auth/callback/[provider]/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as createOrder } from '@/app/api/credits/orders/route';
import { GET as confirm } from '@/app/api/credits/confirm/route';
import { POST as refund } from '@/app/api/credits/refund/route';
import { GET as credits } from '@/app/api/credits/route';
import { POST as createProject } from '@/app/api/projects/route';
import { POST as createTask } from '@/app/api/tasks/route';
import { POST as run } from '@/app/api/agents/run/route';
import { testDatabase } from './d1';
import { env, drainBackground } from './cloudflare-workers';

let database: ReturnType<typeof testDatabase>;
type CreditsView = { mode: string; balance: { promoMc: number; paidMc: number; heldMc: number }; payments: { status: string }[] };
type Handler = (request: Request, context: never) => Promise<Response>;
async function request(handler: Handler, path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const req = new NextRequest(`https://test.local${path}`, { method, headers: { cookie, 'content-type': 'application/json', 'x-orbit-uid': 'spoofed-user' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const gate = await proxy(req);
  if (gate.status >= 300) return gate;
  return runWithHeadersContext(headersContextFromRequest(req), () => {
    applyMiddlewareRequestHeaders(gate.headers);
    return handler(req, { params: { provider: 'google' } } as never);
  });
}
beforeEach(() => {
  database = testDatabase();
  Object.assign(env, { DB: database.db, AUTH_MODE: 'oauth', AUTH_SECRET: 'test-secret-at-least-32-characters', APP_URL: 'https://test.local', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'test-anthropic', TOSS_CLIENT_KEY: 'test_ck_test', TOSS_SECRET_KEY: 'test_sk_test' });
});
afterEach(async () => { await drainBackground(); vi.restoreAllMocks(); vi.unstubAllGlobals(); database.sqlite.close(); for (const key of Object.keys(env)) delete env[key]; });

function providers() {
  let providerPayment: Record<string, unknown> | undefined;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-token' });
    if (url.includes('openidconnect.googleapis.com')) return Response.json({ sub: 'test-user', email: 'test@example.test', name: 'Integration User', email_verified: true });
    if (url.includes('api.tosspayments.com')) {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      if (url.endsWith('/confirm')) providerPayment = { ...body, totalAmount: body.amount, status: 'DONE' };
      if (url.endsWith('/cancel')) providerPayment = { ...providerPayment, status: 'CANCELED' };
      return Response.json(providerPayment);
    }
    if (url.includes('api.anthropic.com')) {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      const review = body.tool_choice?.name === 'submit_review';
      const last = body.messages.at(-1);
      const finished = Array.isArray(last.content) && last.content.some((item: { type: string }) => item.type === 'tool_result');
      return Response.json({ id: crypto.randomUUID(), model: body.model, usage: { input_tokens: 100, output_tokens: 30 }, stop_reason: finished ? 'end_turn' : 'tool_use', content: finished ? [{ type: 'text', text: '완료' }] : [{ type: 'tool_use', id: 'tool-id', name: review ? 'submit_review' : 'complete_task', input: review ? { verdict: 'approve', summary: '확인', findings: [] } : { status: 'completed', summary: '통합 검증 완료', proof: ['테스트 요구사항 확인'] } }] });
    }
    throw new Error(`Unexpected test provider ${new URL(url).hostname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
async function login() {
  const state = await makeState('google');
  const response = await request(callback, `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=test-code`, `orbit_oauth_state=${encodeURIComponent(state)}`);
  expect(response.status).toBe(302);
  const session = response.headers.getSetCookie().find((value) => value.startsWith('orbit_session='));
  expect(session).toContain('HttpOnly'); expect(session).toContain('Secure'); expect(session).toContain('SameSite=Lax');
  return session!.split(';')[0];
}

it('runs OAuth session → charge → metered AI task/review → refund → logout through real handlers and SQLite', async () => {
  providers();
  const cookie = await login();
  const initial = await (await request(credits, '/api/credits', cookie)).json() as CreditsView;
  expect(initial.mode).toBe('credits'); expect(initial.balance.promoMc).toBe(300_000);
  const order = await (await request(createOrder, '/api/credits/orders', cookie, { krw: 5000 })).json() as { orderId: string };
  expect(order.orderId).toBeTruthy();
  const confirmed = await request(confirm, `/api/credits/confirm?orderId=${order.orderId}&paymentKey=test-payment&amount=5000`, cookie);
  expect(confirmed.headers.get('location')).toContain('credits=done');
  expect(confirmed.headers.get('x-request-id')).toBeTruthy();
  await request(confirm, `/api/credits/confirm?orderId=${order.orderId}&paymentKey=test-payment&amount=5000`, cookie);
  const project = await (await request(createProject, '/api/projects', cookie, { name: 'Integration test' })).json() as { project: { id: string }; manager: { name: string } };
  const task = await (await request(createTask, '/api/tasks', cookie, { title: '통합 검증', projectId: project.project.id, owner: project.manager.name, label: '검증' })).json() as { task: { id: string } };
  const execution = await request(run, '/api/agents/run', cookie, { taskId: task.task.id });
  expect(execution.status).toBe(200);
  expect(await execution.json()).toMatchObject({ blocked: false, status: '검토 중' });
  await drainBackground();
  const afterRun = await (await request(credits, '/api/credits', cookie)).json() as CreditsView;
  expect(afterRun.balance.paidMc).toBe(500_000);
  expect(afterRun.balance.promoMc).toBeLessThan(300_000);
  expect(afterRun.balance.heldMc).toBe(0);
  expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind='charge'").get()?.n).toBe(1);
  expect(database.sqlite.prepare('SELECT review_verdict FROM tasks WHERE id=?').get(task.task.id)?.review_verdict).toBe('approve');
  expect((await request(refund, '/api/credits/refund', cookie, { paymentId: order.orderId })).status).toBe(200);
  expect((await request(refund, '/api/credits/refund', cookie, { paymentId: order.orderId })).status).toBe(200);
  const afterRefund = await (await request(credits, '/api/credits', cookie)).json() as CreditsView;
  expect(afterRefund.balance.paidMc).toBe(0); expect(afterRefund.balance.heldMc).toBe(0);
  expect(afterRefund.payments[0].status).toBe('refunded');
  expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind='refund' AND bucket='paid'").get()?.n).toBe(1);
  await request(logout, '/api/auth/logout', cookie, {}, 'POST');
  expect(await findSessionUser(database.db, cookie.split('=')[1])).toBeNull();
  expect((await request(createOrder, '/api/credits/orders', cookie, { krw: 5000 })).status).toBe(401);
});

it('rejects spoofed headers, expired sessions and mismatched OAuth state before providers are contacted', async () => {
  const fetchMock = providers();
  expect((await request(createOrder, '/api/credits/orders', '', { krw: 5000 })).status).toBe(401);
  const invalid = await request(callback, '/api/auth/callback/google?state=wrong&code=test', 'orbit_oauth_state=different');
  expect(invalid.headers.get('location')).toContain('error=state');
  expect(fetchMock).not.toHaveBeenCalled();
  const cookie = await login();
  database.sqlite.exec('UPDATE sessions SET expires_at=0');
  expect((await request(createOrder, '/api/credits/orders', cookie, { krw: 5000 })).status).toBe(401);
});

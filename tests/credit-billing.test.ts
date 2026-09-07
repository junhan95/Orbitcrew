import { afterEach, expect, it } from 'vitest';
import { CreditBilling, getBalance, ledgerInsert, resolveCredential } from '@/lib/credits';
import { env } from './cloudflare-workers';
import { usageToMc } from '@/lib/credits-pricing';
import { testDatabase } from './d1';

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); for (const key of Object.keys(env)) delete env[key]; });
const cfg = { markup: 1.8, fxRate: 1400, trialCredits: 300 };
const usage = { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 };
const model = 'claude-haiku-4-5';
const cost = usageToMc(model, usage, cfg);

it('reports busy rather than asking to recharge when another request reserves the balance', async () => {
  const { db, billing } = await setup(0, 1000);
  env.AUTH_MODE = 'oauth'; env.ANTHROPIC_API_KEY = 'test'; env.CREDIT_TRIAL_CREDITS = '0';
  await billing.beforeCall();
  await expect(resolveCredential(db, 'u', { waitMs: 0 })).rejects.toMatchObject({ status: 409 });
  await billing.afterCall();
  expect(await resolveCredential(db, 'u')).toBeInstanceOf(CreditBilling);
});

async function setup(promo: number, paid: number) {
  const database = testDatabase(); databases.push(database);
  const { db } = database;
  await db.batch([
    ledgerInsert(db, { userId: 'u', kind: 'adjust', bucket: 'promo', amountMc: promo }),
    ledgerInsert(db, { userId: 'u', kind: 'adjust', bucket: 'paid', amountMc: paid }),
  ]);
  const billing = new CreditBilling('test', db, 'u', await getBalance(db, 'u'), cfg, 0);
  return { ...database, billing };
}

it('splits one call across remaining promo and paid credits', async () => {
  const { db, billing } = await setup(100, 1000);
  await billing.beforeCall();
  await billing.onUsage(model, usage);
  await billing.afterCall();
  const balance = await getBalance(db, 'u');
  expect(balance.promoMc).toBe(0);
  expect(balance.paidMc).toBe(1000 - (cost - 100));
  expect(balance.balanceMc).toBe(1100 - cost);
});

it('reserves the balance against concurrent calls and releases it on failure', async () => {
  const { db, billing } = await setup(1000, 1000);
  const second = new CreditBilling('test', db, 'u', await getBalance(db, 'u'), cfg, 0);
  const calls = await Promise.allSettled([billing.beforeCall(), second.beforeCall()]);
  expect(calls.filter((call) => call.status === 'fulfilled')).toHaveLength(1);
  expect((await getBalance(db, 'u')).availableMc).toBe(0);
  await billing.afterCall(); await second.afterCall();
  expect((await getBalance(db, 'u')).availableMc).toBe(2000);
  await second.beforeCall(); await second.onUsage(model, usage); await second.afterCall();
  expect((await getBalance(db, 'u')).balanceMc).toBe(2000 - cost);
});

it('consumes promo exactly at the boundary and never leaves free credit behind', async () => {
  for (const promo of [cost, cost + 100, 100]) {
    const { db, billing } = await setup(promo, 0);
    await billing.beforeCall(); await billing.onUsage(model, usage); await billing.afterCall();
    const balance = await getBalance(db, 'u');
    expect(balance.promoMc).toBe(Math.max(0, promo - cost));
    expect(balance.paidMc).toBe(Math.min(0, promo - cost));
    expect(balance.heldMc).toBe(0);
  }
});

it('recovers an expired crashed reservation without releasing a new one', async () => {
  const { db, sqlite, billing } = await setup(1000, 0);
  await billing.beforeCall();
  sqlite.exec('UPDATE credit_holds SET updated_at = 0');
  const second = new CreditBilling('test', db, 'u', await getBalance(db, 'u'), cfg, 0);
  await second.beforeCall();
  await billing.afterCall();
  expect((await getBalance(db, 'u')).availableMc).toBe(0);
  await second.onUsage(model, usage); await second.afterCall();
  expect((await getBalance(db, 'u')).balanceMc).toBe(1000 - cost);
});

it('queues parallel calls sharing one billing handle instead of dropping background reviews', async () => {
  const { db, billing } = await setup(2000, 0);
  const call = async () => { await billing.beforeCall(); try { await billing.onUsage(model, usage); } finally { await billing.afterCall(); } };
  await Promise.all([call(), call()]);
  expect((await getBalance(db, 'u')).balanceMc).toBe(2000 - 2 * cost);
  expect((await getBalance(db, 'u')).heldMc).toBe(0);
});

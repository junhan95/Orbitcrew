import { afterEach, expect, it } from 'vitest';
import { CreditBilling, getBalance, ledgerInsert } from '@/lib/credits';
import { testDatabase } from './d1';

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });
const cfg = { markup: 1.8, fxRate: 1400, trialCredits: 0 };
const usage = { inputTokens: 200_000, outputTokens: 50_000, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0 };
const model = 'claude-haiku-4-5';

it('크레딧을 먼저 쓰고, 바닥나면 본인 키로 넘어가 이후 호출은 과금하지 않습니다', async () => {
  const database = testDatabase(); databases.push(database);
  const { db } = database;
  await db.batch([ledgerInsert(db, { userId: 'u', kind: 'adjust', bucket: 'paid', amountMc: 5 })]);
  const billing = new CreditBilling('operator', db, 'u', await getBalance(db, 'u'), cfg, 0, 'mine');

  // 1번째 호출: 크레딧으로 나가고(운영자 키), 이 호출로 잔액이 바닥납니다.
  expect(billing.apiKey).toBe('operator');
  await billing.beforeCall();
  const first = await billing.onUsage(model, usage);
  await billing.afterCall();
  expect(first.stop).toBe(false);            // 본인 키가 있으니 멈추지 않음
  expect(billing.usingFallback).toBe(true);
  expect(billing.apiKey).toBe('mine');
  const afterFirst = await getBalance(db, 'u');
  expect(afterFirst.balanceMc).toBeLessThanOrEqual(0);

  // 2번째 호출: 예약 없이 본인 키로 나가고 원장은 그대로입니다.
  await billing.beforeCall();
  const second = await billing.onUsage(model, usage);
  await billing.afterCall();
  expect(second.stop).toBe(false);
  expect((await getBalance(db, 'u')).balanceMc).toBe(afterFirst.balanceMc);
});

it('본인 키가 없으면 예전처럼 바닥나는 순간 멈춥니다', async () => {
  const database = testDatabase(); databases.push(database);
  const { db } = database;
  await db.batch([ledgerInsert(db, { userId: 'u', kind: 'adjust', bucket: 'paid', amountMc: 5 })]);
  const billing = new CreditBilling('operator', db, 'u', await getBalance(db, 'u'), cfg, 0);
  await billing.beforeCall();
  expect((await billing.onUsage(model, usage)).stop).toBe(true);
  await billing.afterCall();
  await expect(billing.beforeCall()).rejects.toMatchObject({ status: 402 });
});

it('잔액이 이미 0 인 상태에서 본인 키가 있으면 첫 호출부터 본인 키로 나갑니다', async () => {
  const database = testDatabase(); databases.push(database);
  const { db } = database;
  const billing = new CreditBilling('operator', db, 'u', await getBalance(db, 'u'), cfg, 0, 'mine');
  await billing.beforeCall();
  expect(billing.usingFallback).toBe(true);
  expect(billing.apiKey).toBe('mine');
  await billing.afterCall();
});

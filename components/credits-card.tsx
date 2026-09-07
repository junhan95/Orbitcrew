'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Coins, ExternalLink, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCredits, mcToKrw } from '@/lib/credits-pricing';
import { locale, t, tf } from '@/lib/i18n';
import './credits.css';

/**
 * 계정 > 크레딧 카드 (docs/pricing-credits.md §5).
 * 잔액·체험 안내·충전 단위·모델별 단가표·원장 내역을 /api/credits 하나로 그립니다.
 * 충전은 토스페이먼츠 결제창(v2 SDK): /api/credits/orders 로 주문을 만들고 payment.requestPayment 로 결제창을 엽니다.
 * 인증이 끝나면 토스가 /api/credits/confirm(successUrl) 로 보내고, 서버가 승인·원장 기록 후 앱(?credits=done)으로 돌려보냅니다.
 */

/** 토스 v2 SDK 전역 (https://js.tosspayments.com/v2/standard). 필요한 부분만 선언합니다. */
type TossPaymentsSdk = (clientKey: string) => {
  payment: (options: { customerKey: string }) => {
    requestPayment: (options: Record<string, unknown>) => Promise<void>;
  };
};
declare global { interface Window { TossPayments?: TossPaymentsSdk } }
const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

function loadTossSdk(): Promise<TossPaymentsSdk> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TOSS_SDK_URL}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: TOSS_SDK_URL, async: true });
    script.addEventListener('load', () => window.TossPayments ? resolve(window.TossPayments) : reject(new Error('SDK load failed')));
    script.addEventListener('error', () => reject(new Error('SDK load failed')));
    if (!existing) document.head.appendChild(script);
  });
}

type CheckoutOrder = {
  orderId: string; amount: number; orderName: string; clientKey: string | null; customerKey: string;
  customerEmail?: string; customerName?: string; successUrl: string; failUrl: string;
};

type LedgerKind = 'trial' | 'charge' | 'bonus' | 'usage' | 'refund' | 'adjust';
type CreditsData = {
  mode: 'local' | 'byok' | 'credits';
  unit: { krwPerCredit: number };
  balance: { balanceMc: number; heldMc: number; availableMc: number; paidMc: number; promoMc: number; availableKrw: number };
  trial: { justGranted: boolean; credits: number; allowedModels: readonly string[] };
  tiers: { krw: number; credits: number; bonusPct: number }[];
  rates: { models: { model: string; input: number; output: number; cacheWrite: number; cacheRead: number }[]; webSearchPerCall: number; config: { markup: number; fxRate: number } };
  ledger: { id: string; kind: LedgerKind; bucket: 'paid' | 'promo'; amountMc: number; refType: string | null; refId: string | null; meta: Record<string, unknown> | null; createdAt: number }[];
  payments: { id: string; amountKrw: number; creditsMc: number; bonusMc: number; status: 'done' | 'failed' | 'canceled' | 'refunded' | 'confirming' | 'refund_pending'; method: string | null; receiptUrl: string | null; approvedAt: number | null; createdAt: number; refundable: boolean }[];
  checkout: { enabled: boolean };
  /** 베타 운영(docs/pricing-credits.md §10): 테스트 결제 = 실청구 없음, 월 충전 한도. */
  beta: { enabled: boolean; capMc: number; usedMc: number; remainingMc: number; resetsAt: number };
};

const PAYMENT_STATUS_LABEL: Record<CreditsData['payments'][number]['status'], string> = {
  done: '완료', failed: '실패', canceled: '취소', refunded: '환불됨', confirming: '결제 확인 중', refund_pending: '환불 확인 중',
};

/** 잔액이 이보다 적으면 경고 (크레딧) */
const LOW_BALANCE_CREDITS = 50;

const KIND_LABEL: Record<LedgerKind, string> = {
  trial: '체험 지급', charge: '충전', bonus: '보너스', usage: '사용', refund: '환불', adjust: '조정',
};

export async function fetchCredits(limit = 20): Promise<CreditsData> {
  const response = await fetch(`/api/credits?limit=${limit}`);
  if (!response.ok) throw new Error(t('크레딧 정보를 불러오지 못했습니다.'));
  return await response.json() as CreditsData;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString(locale())}${t('원')}`;
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1');
}

export function CreditsCard({ onNotice, onConnectKey, refreshKey }: { onNotice: (message: string) => void; onConnectKey?: () => void; /** 바뀌면 다시 읽습니다 — API 키 연결·삭제 뒤 과금 경로가 바뀌므로 */ refreshKey?: unknown }) {
  const [data, setData] = useState<CreditsData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchCredits().then(setData).catch((err) => setError(err instanceof Error ? err.message : t('크레딧 정보를 불러오지 못했습니다.')));
  }, []);

  // oxlint-disable-next-line react/react-compiler -- 서버 데이터를 마운트 후(그리고 키 상태가 바뀔 때마다) 채웁니다
  useEffect(() => {
    let alive = true;
    fetchCredits().then((next) => { if (alive) setData(next); }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : t('크레딧 정보를 불러오지 못했습니다.')); });
    return () => { alive = false; };
  }, [refreshKey]);

  /** 주문 생성 → 토스 결제창. 결제창이 열리면 페이지를 떠나므로 이후는 successUrl/failUrl 이 이어받습니다. */
  async function startCheckout(krw: number) {
    setBusy(`charge:${krw}`);
    try {
      const response = await fetch('/api/credits/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ krw }) });
      const order = await response.json() as CheckoutOrder & { error?: string };
      if (!response.ok || !order.clientKey) throw new Error(order.error || t('주문을 만들지 못했습니다.'));
      const sdk = await loadTossSdk();
      const payment = sdk(order.clientKey).payment({ customerKey: order.customerKey });
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: order.amount },
        orderId: order.orderId, orderName: order.orderName,
        successUrl: order.successUrl, failUrl: order.failUrl,
        customerEmail: order.customerEmail, customerName: order.customerName,
        card: { useEscrow: false, flowMode: 'DEFAULT', useCardPoint: false, useAppCardOnly: false },
      });
    } catch (err) {
      // 사용자가 결제창을 닫으면 SDK 가 거부(reject)합니다 — 오류로 취급하지 않습니다.
      const message = err instanceof Error ? err.message : '';
      if (!/USER_CANCEL|PAY_PROCESS_CANCELED|취소/.test(message)) onNotice(message || t('결제창을 열지 못했습니다.'));
    } finally { setBusy(null); }
  }

  async function refund(paymentId: string) {
    if (!window.confirm(t('이 결제를 전액 취소하고 크레딧을 회수할까요?'))) return;
    setBusy(`refund:${paymentId}`);
    try {
      const response = await fetch('/api/credits/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || t('환불하지 못했습니다.'));
      onNotice(t('환불이 완료되었습니다. 카드사 처리에는 며칠이 걸릴 수 있습니다.'));
    } catch (err) { onNotice(err instanceof Error ? err.message : t('환불하지 못했습니다.')); }
    finally { setBusy(null); reload(); }
  }

  async function reconcile(paymentId: string, isRefund: boolean) {
    setBusy(paymentId);
    try {
      const response = await fetch(isRefund ? '/api/credits/refund' : '/api/credits/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t('처리 결과를 확인하지 못했습니다.'));
      onNotice(t('처리 결과를 확인했습니다.'));
    } catch (err) { onNotice(err instanceof Error ? err.message : t('처리 결과를 확인하지 못했습니다.')); }
    finally { setBusy(null); reload(); }
  }

  if (error) return <section className="settings-card credits-card"><p className="credits-error">{error}</p></section>;
  if (!data) return <section className="settings-card credits-card"><div className="view-loading"><LoaderCircle className="spin" /><span>{t('크레딧을 불러오는 중')}</span></div></section>;

  const { mode, balance, trial, tiers, rates, ledger, payments, checkout, beta } = data;
  const available = balance.availableMc;
  const low = mode === 'credits' && available < LOW_BALANCE_CREDITS * 1000;
  const trialOnly = balance.paidMc <= 0;
  const betaOn = beta?.enabled === true && mode !== 'local';
  const betaCapped = betaOn && beta.capMc > 0;
  const betaExhausted = betaCapped && beta.remainingMc <= 0;
  const monthName = (ms: number) => new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric' }).format(ms);

  const description = mode === 'local'
    ? t('로컬 모드 — .env 의 키로 실행되며 크레딧을 쓰지 않습니다.')
    : mode === 'byok'
      ? t('본인 Anthropic API 키가 연결됨 — 크레딧을 먼저 쓰고, 잔액이 바닥나면 본인 키로 이어서 실행됩니다 (키로 나간 호출은 크레딧을 차감하지 않습니다).')
      : t('연결된 키가 없어 크레딧으로 실행됩니다. 호출마다 실측 토큰만큼 차감됩니다.');

  return <section className="settings-card credits-card">
    <div className="settings-title credits-title">
      <Coins size={16} /><div><strong>{t('크레딧')}</strong><p>{description}</p></div>
      {/* 베타 운영 기간에만 표시 (docs/pricing-credits.md §10) — 서버가 beta.enabled 를 줄 때만 */}
      {betaOn ? <div className="credits-beta" role="note" title={betaCapped ? tf('한 달에 {0} 크레딧까지 충전할 수 있고, 베타가 끝나면 남은 베타 크레딧은 소멸됩니다.', formatCredits(beta.capMc)) : undefined}>
        <span className="credits-beta-badge">BETA</span>
        <span>{t('베타 운영 기간에는 실제 과금이 진행되지 않습니다.')}</span>
      </div> : null}
    </div>

    <div className="credits-balance">
      <div className="credits-amount">
        <strong>{formatCredits(available)}</strong>
        <span>{t('크레딧')}</span>
        <em>≈ {won(mcToKrw(available))}</em>
      </div>
      <dl className="credits-split">
        <div><dt>{t('무료 · 보너스')}</dt><dd>{formatCredits(Math.max(0, balance.promoMc))}</dd></div>
        <div><dt>{t('유료')}</dt><dd>{formatCredits(Math.max(0, balance.paidMc))}</dd></div>
        <div><dt>{t('단위')}</dt><dd>{tf('1 크레딧 = {0}원', data.unit.krwPerCredit)}</dd></div>
      </dl>
    </div>

    {low ? <p className="credits-note warn"><TriangleAlert size={13} /> {available <= 0 ? t('잔액이 없습니다. 충전하거나 본인 API 키를 연결해야 에이전트를 돌릴 수 있습니다.') : tf('잔액이 {0} 크레딧 미만입니다. 실행 중 바닥나면 거기까지의 결과로 멈춥니다.', LOW_BALANCE_CREDITS)}</p> : null}
    {mode === 'credits' && trialOnly && available > 0 ? <p className="credits-note"><ShieldCheck size={13} /> {tf('체험 크레딧으로 실행 중 — {0} 모델을 씁니다. 충전하면 상위 모델도 열립니다.', trial.allowedModels.map(shortModel).join(' · '))}</p> : null}
    {trial.justGranted ? <p className="credits-note ok"><ShieldCheck size={13} /> {tf('가입 체험 크레딧 {0} 을 지급했습니다.', trial.credits)}</p> : null}

    <div className="credits-tiers">
      <p className="credits-label">{t('충전')}</p>
      <div className="credits-tier-row">
        {tiers.map((tier) => <Button key={tier.krw} disabled={!checkout.enabled || busy !== null || (betaCapped && tier.credits * 1000 > beta.remainingMc)} onClick={() => void startCheckout(tier.krw)} size="sm" variant="outline">
          {busy === `charge:${tier.krw}` ? <LoaderCircle className="spin" size={13} /> : null}
          {won(tier.krw)} <small>{tier.credits.toLocaleString(locale())}{tier.bonusPct ? ` +${tier.bonusPct}%` : ''}</small>
        </Button>)}
        {mode === 'credits' && onConnectKey ? <Button onClick={onConnectKey} size="sm" variant="ghost">{t('본인 키 연결 (무료)')}</Button> : null}
      </div>
      <p className="credits-hint">{betaOn
        ? (betaExhausted
          ? tf('이번 달 베타 충전 한도를 다 썼습니다. {0} 에 초기화되며, 그 전에는 본인 API 키를 연결해 쓸 수 있습니다.', monthName(beta.resetsAt))
          : (betaCapped
            ? tf('베타 테스트 결제(토스페이먼츠) — 카드 정보를 넣어도 청구되지 않습니다. 한 달에 {0} 크레딧까지 충전할 수 있고, 남은 베타 크레딧은 베타 종료 시 소멸됩니다. 본인 Claude API 키를 연결하면 크레딧이 바닥난 뒤에도 그 키로 이어서 실행됩니다.', formatCredits(beta.capMc))
            : t('베타 테스트 결제(토스페이먼츠) — 카드 정보를 넣어도 청구되지 않습니다. 남은 베타 크레딧은 베타 종료 시 소멸됩니다. 본인 Claude API 키를 연결하면 그 키로 실행됩니다.')))
        : checkout.enabled
          ? t('카드로 결제됩니다(토스페이먼츠). 미사용 유료 크레딧은 아래 결제 목록에서 전액 취소할 수 있고, 무료 · 보너스 크레딧은 환불되지 않습니다.')
          : t('카드 · 계좌이체 결제는 준비 중입니다. 미사용 유료 크레딧은 환불되고, 무료 · 보너스 크레딧은 환불되지 않습니다.')}</p>
      {betaCapped ? <p className="credits-beta-quota">
        <span>{tf('이번 달 충전 {0} / {1} 크레딧', formatCredits(beta.usedMc), formatCredits(beta.capMc))}</span>
        <i><b style={{ width: `${Math.min(100, Math.round((beta.usedMc / beta.capMc) * 100))}%` }} /></i>
        <span>{tf('{0} 초기화', monthName(beta.resetsAt))}</span>
      </p> : null}
    </div>

    <details className="credits-rates">
      <summary><span>{t('모델별 단가 (100만 토큰당 크레딧)')}</span><ChevronDown size={14} /></summary>
      <table>
        <thead><tr><th>{t('모델')}</th><th>{t('입력')}</th><th>{t('출력')}</th><th>{t('캐시 쓰기')}</th><th>{t('캐시 읽기')}</th></tr></thead>
        <tbody>
          {rates.models.map((row) => <tr key={row.model}>
            <td><code>{row.model}</code></td>
            <td>{row.input.toLocaleString(locale())}</td><td>{row.output.toLocaleString(locale())}</td>
            <td>{row.cacheWrite.toLocaleString(locale())}</td><td>{row.cacheRead.toLocaleString(locale())}</td>
          </tr>)}
          <tr><td>{t('웹 검색 (1회)')}</td><td colSpan={4}>{rates.webSearchPerCall.toLocaleString(locale())}</td></tr>
        </tbody>
      </table>
      <p className="credits-hint">{tf('Anthropic 공개 단가 × {0} · 환율 {1}원/USD · 부가세 포함', rates.config.markup, rates.config.fxRate.toLocaleString(locale()))}</p>
    </details>

    {payments.length ? <div className="credits-payments">
      <p className="credits-label">{t('결제')}</p>
      <ul>
        {payments.map((p) => <li key={p.id}>
          <span className={`credits-kind credits-pay-${p.status}`}>{t(PAYMENT_STATUS_LABEL[p.status])}</span>
          <span className="credits-desc">{won(p.amountKrw)} · {formatCredits(p.creditsMc + p.bonusMc)} {t('크레딧')}{p.method ? <small> · {p.method}</small> : null}</span>
          <time dateTime={new Date(p.approvedAt ?? p.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(p.approvedAt ?? p.createdAt)}</time>
          <span className="credits-pay-actions">
            {p.receiptUrl ? <a href={p.receiptUrl} rel="noreferrer" target="_blank">{t('영수증')} <ExternalLink size={11} /></a> : null}
            {p.refundable ? <Button disabled={busy !== null} onClick={() => void refund(p.id)} size="sm" variant="ghost">{busy === `refund:${p.id}` ? <LoaderCircle className="spin" size={13} /> : t('환불')}</Button> : null}
            {p.status === 'confirming' || p.status === 'refund_pending' ? <Button disabled={busy !== null} onClick={() => void reconcile(p.id, p.status === 'refund_pending')} size="sm" variant="ghost">{busy === p.id ? <LoaderCircle className="spin" size={13} /> : t('처리 결과 확인')}</Button> : null}
          </span>
        </li>)}
      </ul>
    </div> : null}

    <div className="credits-ledger">
      <p className="credits-label">{t('내역')}</p>
      {ledger.length === 0 ? <p className="credits-hint">{t('아직 내역이 없습니다.')}</p> : <ul>
        {ledger.map((row) => {
          const model = typeof row.meta?.model === 'string' ? shortModel(row.meta.model) : null;
          const webSearch = typeof row.meta?.webSearch === 'number' && row.meta.webSearch > 0 ? row.meta.webSearch : 0;
          return <li key={row.id}>
            <span className={`credits-kind credits-kind-${row.kind}`}>{t(KIND_LABEL[row.kind])}</span>
            <span className="credits-desc">
              {model ?? (row.refType === 'signup' ? t('가입') : row.refType ?? '')}
              {webSearch ? <small> · {tf('웹 검색 {0}회', webSearch)}</small> : null}
              {row.meta?.beta === true ? <small> · {t('베타 충전')}</small> : null}
            </span>
            <time dateTime={new Date(row.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(row.createdAt)}</time>
            <span className={row.amountMc < 0 ? 'credits-amt neg' : 'credits-amt pos'}>{row.amountMc < 0 ? '−' : '+'}{formatCredits(Math.abs(row.amountMc))}</span>
          </li>;
        })}
      </ul>}
    </div>
  </section>;
}

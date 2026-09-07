'use client';

import { useCallback, useEffect, useState } from 'react';
import { isReviewStatus } from '@/lib/task-status';
import { Activity, LoaderCircle, RefreshCw, ShieldAlert, Stethoscope } from 'lucide-react';
import { t, tf, locale, getLang } from '@/lib/i18n';
import './governance.css';

/**
 * 실행 건강 카드 — 대쉬보드용.
 *   GET  /api/health : 지표 5개(오늘 vs 14일 기준선, σ 등급), 최근 7일 실행 제어 요약, 열린 '진단' 카드, 마지막 검사
 *   POST /api/health : 지금 검사 → 2σ 이상 지표마다 진단 카드 생성(24시간 내 중복 없음)
 * 지표 계산에는 모델을 쓰지 않습니다. 이 카드는 숫자를 보여 주고, 판단은 진단 카드를 실행하는 에이전트와 사람이 합니다.
 */

type Tier = 'ok' | 'watch' | 'diagnose' | 'act' | 'insufficient';
type Metric = { key: string; label: string; unit: 'ratio' | 'usd'; current: number | null; currentSamples: number; sigma: number | null; tier: Tier; note: string };
type GateRow = { gate: string; decision: string; count: number };
type Diagnosis = { id: string; title: string; owner: string; status: string; projectId: string | null; createdAt: number };
type HealthResponse = { metrics: Metric[]; gates: GateRow[]; diagnoses: Diagnosis[]; lastCheck: { decision: string; detail: string | null; at: number } | null };

const TIER_LABEL: Record<Tier, string> = { ok: '정상', watch: '관찰', diagnose: '진단', act: '조치', insufficient: '데이터 부족' };
const GATE_LABEL: Record<string, string> = {
  approval: '승인 큐', circuit_breaker: '서킷브레이커', recall_cap: '회상 상한', memory_threat: '기억 위협 패턴', health_check: '건강 검사',
  skill_threat: '스킬 위협 패턴', create_task: '카드 상한',
};

function formatWhen(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function HealthCard({ onNotice, onOpenTask, compact = false }: {
  onNotice: (message: string) => void;
  /** 진단 카드를 눌렀을 때 — 프로젝트 보드로 이동시키는 등. 없으면 제목만 표시 */
  onOpenTask?: (task: Diagnosis) => void;
  /** 대쉬보드 사이드 영역용 축약 모드 (지표만) */
  compact?: boolean;
}) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error();
      setData(await response.json() as HealthResponse);
    } catch { onNotice(t('실행 건강 지표를 불러오지 못했습니다.')); }
    finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 카드가 보일 때 한 번 읽습니다
  useEffect(() => { void load(); }, [load]);

  async function checkNow() {
    setChecking(true);
    try {
      const response = await fetch('/api/health', { method: 'POST' });
      const result = await response.json() as { raised: { key: string }[]; skipped: { key: string; reason: string }[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? t('검사하지 못했습니다.'));
      onNotice(result.raised.length ? tf('진단 카드 {0}장을 만들었습니다.', result.raised.length) : t('평소 범위를 벗어난 실행 지표가 없습니다.'));
      await load();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('검사하지 못했습니다.')); }
    finally { setChecking(false); }
  }

  const metrics = data?.metrics ?? [];
  const worst = metrics.reduce<Tier>((acc, metric) => rank(metric.tier) > rank(acc) ? metric.tier : acc, 'insufficient');
  const openDiagnoses = (data?.diagnoses ?? []).filter((task) => !isReviewStatus(task.status));
  const blocks = (data?.gates ?? []).filter((row) => row.decision === 'block');
  const asks = (data?.gates ?? []).filter((row) => row.decision === 'ask');

  return <article className={compact ? 'gov-card' : 'gov-card wide'} data-testid="health-card">
    <header className="gov-card-head">
      <div>
        <h2><Activity size={16} /> {t('실행 건강')} <span className={`gov-chip ${worst}`}>{t(TIER_LABEL[worst])}</span></h2>
        <p>{data?.lastCheck ? tf('마지막 검사 {0}', formatWhen(data.lastCheck.at)) : t('아직 검사한 적이 없습니다. 실행이 끝나면 최대 1시간에 한 번 자동으로 검사합니다.')}</p>
      </div>
      <div className="gov-toolbar">
        <button className="gov-button ghost" onClick={() => void load()} disabled={loading} title={t('새로고침')}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}</button>
        <button className="gov-button" onClick={() => void checkNow()} disabled={checking}>{checking ? <LoaderCircle size={14} className="spin" /> : <Stethoscope size={14} />} {t('지금 검사')}</button>
      </div>
    </header>

    {openDiagnoses.length > 0 && <div className="gov-banner">
      <ShieldAlert size={16} />
      <span><strong>{tf('열린 진단 카드 {0}장', openDiagnoses.length)}</strong> — {openDiagnoses.slice(0, 2).map((task) => task.title).join(' · ')}{openDiagnoses.length > 2 ? ' …' : ''}</span>
      {onOpenTask && <button className="gov-button" onClick={() => onOpenTask(openDiagnoses[0])}>{t('보드에서 보기')}</button>}
    </div>}

    <div>
      {metrics.map((metric) => <div className="gov-metric" key={metric.key}>
        <div>
          <b>{t(metric.label)}</b>
          <small>{healthNote(metric.note) || t('아직 표본이 없습니다.')}</small>
        </div>
        <span className={`gov-chip ${metric.tier}`} title={metric.sigma === null ? '' : `${metric.sigma}σ`}>{t(TIER_LABEL[metric.tier])}</span>
      </div>)}
      {!loading && metrics.length === 0 && <p className="gov-empty">{t('지표를 계산할 실행 기록이 아직 없습니다.')}</p>}
    </div>

    {!compact && (blocks.length > 0 || asks.length > 0) && <div className="gov-inline">
      <small className="gov-usage" style={{ marginLeft: 0 }}>{t('최근 7일 실행 제어')}</small>
      {blocks.map((row) => <span className="gov-chip blocked" key={`${row.gate}-b`}>{t(GATE_LABEL[row.gate] ?? row.gate)} {t('차단')} {row.count}</span>)}
      {asks.map((row) => <span className="gov-chip pending" key={`${row.gate}-a`}>{t(GATE_LABEL[row.gate] ?? row.gate)} {t('승인 요청')} {row.count}</span>)}
    </div>}
  </article>;
}

function rank(tier: Tier): number {
  return tier === 'act' ? 4 : tier === 'diagnose' ? 3 : tier === 'watch' ? 2 : tier === 'ok' ? 1 : 0;
}

function healthNote(note: string) {
  if (getLang() !== 'en') return note;
  return note.replace(/기준선 부족 \((\d+)\/(\d+)일\)/, 'Insufficient baseline ($1/$2 days)')
    .replace(/오늘 표본 부족 \((\d+)\/(\d+)\)/, 'Insufficient samples today ($1/$2)')
    .replace('오늘 ', 'Today ').replace('표본 ', 'samples: ').replace('기준 ', 'baseline ');
}

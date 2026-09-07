'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronRight, LoaderCircle, Play, Search, ShieldAlert } from 'lucide-react';
import { t, tf } from '@/lib/i18n';
import './governance.css';

/**
 * 검토 열 부속품 — 카드/상세 패널에 끼워 넣는 작은 조각들입니다.
 *   ReviewBadge   : review_verdict(승인 가능/수정 요청) · blocked 배지
 *   ReviewComment : "🔍 검토 —" 로 시작하는 에이전트 댓글을 접힌 <details> 로 (Important 줄 강조)
 *   ReviewActions : [수정 반영 재실행] [다시 검토] — 서킷브레이커(409)면 배너로 이유를 보여 주고 '그래도 실행' 제공
 * 상태 전이는 하지 않습니다. 검토 발견은 카드 상태를 바꾸지 않고, 승인은 사람이 칸반에서 끕니다.
 */

export const REVIEW_PREFIX = '🔍 검토 —';
export const BLOCKED_PREFIX = '⛔ 진행 불가';

export function isReviewComment(content: string) { return content.startsWith(REVIEW_PREFIX); }
export function isBlockedComment(content: string) { return content.startsWith(BLOCKED_PREFIX); }

export function ReviewBadge({ verdict, blockedReason, size = 'chip' }: {
  verdict: string | null | undefined; blockedReason: string | null | undefined; size?: 'chip' | 'dot';
}) {
  if (blockedReason) {
    return <span className="gov-chip blocked" title={blockedReason}><ShieldAlert size={10} /> {size === 'chip' ? t('진행 불가') : ''}</span>;
  }
  if (verdict === 'approve') return <span className="gov-chip approve" title={t('검토 에이전트가 승인 가능으로 판정')}><Search size={10} /> {size === 'chip' ? t('승인 가능') : ''}</span>;
  if (verdict === 'changes_requested') return <span className="gov-chip changes" title={t('검토 에이전트가 수정을 요청함')}><Search size={10} /> {size === 'chip' ? t('수정 요청') : ''}</span>;
  return null;
}

/** 🔍 검토 댓글을 접어서 보여 줍니다. 첫 줄이 요약(판정 · 개수), 나머지는 펼쳐야 보입니다. */
export function ReviewComment({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  const [head, ...rest] = content.split('\n');
  const changes = head.includes('수정 요청');
  return <details className="gov-review" open={defaultOpen || undefined}>
    <summary>
      <ChevronRight size={14} className="caret" />
      <span className={changes ? 'gov-chip changes' : 'gov-chip approve'}>{changes ? t('수정 요청') : t('승인 가능')}</span>
      <span>{head.replace(REVIEW_PREFIX, '').replace(/^\s*(승인 가능|수정 요청)\s*/, '').trim()}</span>
    </summary>
    <div className="gov-review-body">
      {markSections(rest).map(({ line, important }, index) => <div key={index} className={important ? 'important' : undefined}>{line || ' '}</div>)}
    </div>
  </details>;
}

/** 'Important:' 절의 줄만 강조하고 'Nit:' 절부터는 평문으로 돌립니다. */
function markSections(lines: string[]): { line: string; important: boolean }[] {
  let inImportant = false;
  return lines.map((line) => {
    if (line.startsWith('Important')) inImportant = true;
    else if (line.startsWith('Nit') || line.startsWith('다시 실행하면')) inImportant = false;
    return { line, important: inImportant };
  });
}

type CircuitBreaker = { tripped: boolean; consecutive: number; limit: number; lastHumanInputAt: number | null };
type RunResult = { runId?: string; status?: string; blocked?: boolean; blockedReason?: string | null; summary?: string; error?: string; circuitBreaker?: CircuitBreaker };
type ReviewResult = { review?: { verdict: 'approve' | 'changes_requested'; summary: string; findings: unknown[]; hiddenNits: number }; error?: string };

export function ReviewActions({ taskId, hasResult, onNotice, onDone }: {
  taskId: string;
  /** 실행 결과가 있어야 '다시 검토' 가 의미 있음 */
  hasResult: boolean;
  onNotice: (message: string) => void;
  /** 실행/검토가 끝난 뒤 — 보드와 상세를 다시 읽게 */
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<'run' | 'review' | null>(null);
  const [breaker, setBreaker] = useState<CircuitBreaker | null>(null);

  async function run(force = false) {
    setBusy('run');
    try {
      const response = await fetch('/api/agents/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId, force, reportToManager: 'auto' }) });
      const data = await response.json().catch(() => ({})) as RunResult;
      if (response.status === 409 && data.circuitBreaker) { setBreaker(data.circuitBreaker); return; }
      if (!response.ok) throw new Error(data.error ?? t('실행하지 못했습니다.'));
      setBreaker(null);
      onNotice(data.blocked ? tf('진행 불가로 끝났습니다: {0}', data.blockedReason ?? '') : t('실행을 마쳤습니다. 검토 에이전트가 곧 댓글을 남깁니다.'));
      onDone?.();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('실행하지 못했습니다.')); }
    finally { setBusy(null); }
  }

  async function review() {
    setBusy('review');
    try {
      const response = await fetch(`/api/tasks/${taskId}/review`, { method: 'POST' });
      const data = await response.json().catch(() => ({})) as ReviewResult;
      if (!response.ok || !data.review) throw new Error(data.error ?? t('검토하지 못했습니다.'));
      onNotice(data.review.verdict === 'approve' ? t('검토 결과: 승인 가능') : tf('검토 결과: 수정 요청 ({0}건)', data.review.findings.length));
      onDone?.();
    } catch (error) { onNotice(error instanceof Error ? error.message : t('검토하지 못했습니다.')); }
    finally { setBusy(null); }
  }

  return <div className="gov-form">
    {breaker && <div className="gov-banner">
      <AlertTriangle size={16} />
      <span><strong>{tf('연속 {0}회 실패·막힘으로 자동 실행이 멈췄습니다.', breaker.consecutive)}</strong> {t('댓글로 지시를 남기거나 본문을 보완하면 카운터가 초기화됩니다.')}</span>
      <button className="gov-button danger" disabled={busy !== null} onClick={() => void run(true)}>{t('그래도 실행')}</button>
    </div>}
    <div className="gov-item-actions">
      <button className="gov-button primary" disabled={busy !== null} onClick={() => void run(false)}>{busy === 'run' ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />} {hasResult ? t('수정 반영 재실행') : t('실행')}</button>
      <button className="gov-button" disabled={busy !== null || !hasResult} title={hasResult ? '' : t('실행 결과가 있어야 검토할 수 있습니다')} onClick={() => void review()}>{busy === 'review' ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />} {t('다시 검토')}</button>
      {busy === 'run' && <small className="gov-usage">{t('실행 중 — 길면 몇 분 걸립니다')}</small>}
    </div>
  </div>;
}

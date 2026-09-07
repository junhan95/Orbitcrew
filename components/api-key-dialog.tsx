'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';

export type ApiKeyState = { mode: 'local' | 'oauth'; configured: boolean; hint: string | null; updatedAt: number | null; required: boolean };

/** 서버에 저장된 키 상태. 키 자체는 오지 않습니다. */
export async function fetchApiKeyState(): Promise<ApiKeyState> {
  const response = await fetch('/api/keys');
  if (!response.ok) throw new Error(t('API 키 상태를 불러오지 못했습니다.'));
  return await response.json() as ApiKeyState;
}

/**
 * 어떤 API 응답이든 409 { code: 'no_api_key' } 면 이 이벤트를 쏩니다.
 * 화면 곳곳의 fetch 를 일일이 손대지 않으려고 window.fetch 를 한 겹 감쌉니다 (앱 셸에서 한 번만).
 */
export const NO_API_KEY_EVENT = 'orbit:no-api-key';
/**
 * 402 { code: 'insufficient_credits' | 'provider_credits' } — 크레딧이 바닥났을 때. detail 은 { message, cause }:
 * cause 'credits' 는 orbitcrew 크레딧, 'provider' 는 연결한 본인 키의 Anthropic 계정 잔액.
 */
export const INSUFFICIENT_CREDITS_EVENT = 'orbit:insufficient-credits';
export type InsufficientCreditsDetail = { message: string; cause: 'credits' | 'provider' };
let installed = false;
export function installNoApiKeyWatcher() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status === 409 || response.status === 402) {
      try {
        const data = await response.clone().json() as { code?: string; error?: string };
        if (data?.code === 'no_api_key') window.dispatchEvent(new CustomEvent(NO_API_KEY_EVENT));
        if (data?.code === 'insufficient_credits' || data?.code === 'provider_credits') {
          const detail: InsufficientCreditsDetail = { message: data.error ?? '', cause: data.code === 'provider_credits' ? 'provider' : 'credits' };
          window.dispatchEvent(new CustomEvent(INSUFFICIENT_CREDITS_EVENT, { detail }));
        }
      } catch { /* JSON 이 아니면 우리 관심사가 아닙니다 */ }
    }
    return response;
  };
}

/**
 * Anthropic API 키 연결 모달.
 * 키는 선택입니다 — 없으면 크레딧으로 실행됩니다(docs/pricing-credits.md). 운영자 키가 없어 크레딧 경로가 닫힌 배포에서만
 * (`required`) 첫 로그인과 409 응답 때 자동으로 뜹니다.
 * 키는 서버로 한 번 보내져 검증·암호화 저장되고, 이 컴포넌트는 값을 어디에도 남기지 않습니다.
 */
export function ApiKeyDialog({ open, state, onOpenChange, onSaved, onNotice }: {
  open: boolean; state: ApiKeyState | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (next: ApiKeyState) => void;
  onNotice: (message: string) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // oxlint-disable-next-line react/react-compiler -- 열릴 때마다 입력을 비웁니다
  useEffect(() => { if (open) { setValue(''); setError(''); } }, [open]);

  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: value }) });
      const data = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(data.error || t('키를 저장하지 못했습니다.'));
      onSaved(data);
      onOpenChange(false);
      onNotice(t('Anthropic API 키를 연결했습니다. 이제 에이전트 실행·대화 비용이 이 키로 청구됩니다.'));
    } catch (err) { setError(err instanceof Error ? err.message : t('키를 저장하지 못했습니다.')); }
    finally { setBusy(false); }
  }

  const replacing = Boolean(state?.configured);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="create-entity-dialog api-key-dialog">
      <DialogHeader>
        <DialogTitle><KeyRound size={16} /> {replacing ? t('Anthropic API 키 바꾸기') : t('Anthropic API 키 연결')}</DialogTitle>
        <DialogDescription>
          {t('본인 Anthropic API 키를 연결하면 크레딧 대신 이 키로 에이전트를 돌립니다. 사용량은 본인 Console 에 청구되고, orbitcrew 는 무료입니다. 이 앱은 사용자별 토큰·비용만 실측합니다.')}
        </DialogDescription>
      </DialogHeader>

      <ol className="api-key-steps">
        <li><a href="https://platform.claude.com/settings/keys" rel="noreferrer" target="_blank">Claude Console → API Keys <ExternalLink size={12} /></a> {t('에서 키를 만듭니다')}</li>
        <li>{t('아래에 붙여 넣으면 Anthropic 에 한 번 확인한 뒤 암호화해 저장합니다')}</li>
      </ol>

      <label className="entity-field">
        <span>{t('API 키')}</span>
        <input
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && value.trim() && !busy) void save(); }}
          placeholder="sk-ant-api03-…"
          spellCheck={false}
          type="password"
          value={value}
        />
        <small className="entity-hint"><ShieldCheck size={12} /> {t('키는 서버에 AES-GCM 으로 암호화되어 저장되고 화면에는 끝 4자만 보입니다.')}</small>
      </label>

      {error ? <p className="login-error" role="alert">{error}</p> : null}
      {state?.configured && state.hint ? <p className="api-key-current">{t('현재 연결된 키')}: <code>{state.hint}</code></p> : null}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{state?.required && !state.configured ? t('나중에') : t('취소')}</DialogClose>
        <Button disabled={!value.trim() || busy} onClick={() => void save()}>
          {busy ? <><LoaderCircle className="spin" size={14} /> {t('확인 중')}</> : (replacing ? t('키 바꾸기') : t('연결'))}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

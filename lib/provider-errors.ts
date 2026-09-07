/**
 * Anthropic API 오류를 사용자가 이해하고 조치할 수 있는 한글 문장으로 바꿉니다.
 * 원문("Your credit balance is too low …")은 무엇을 해야 하는지 알려 주지 않고, 우리 앱의 크레딧과 헷갈리기 쉽습니다 —
 * 잔액 부족은 "연결한 본인 키의 Anthropic 계정 잔액" 문제라는 점과 두 가지 해결책(충전 / 키 제거 → orbitcrew 크레딧)을 함께 적습니다.
 */
export function describeProviderError(status: number, message: string | undefined): string {
  const text = (message ?? '').trim();
  const lower = text.toLowerCase();
  if (lower.includes('credit balance is too low') || lower.includes('insufficient credit')) {
    return '연결한 Anthropic API 키의 계정 잔액이 부족합니다. Claude API 크레딧은 Claude 구독 요금과 별도로 청구되며 platform.claude.com/dashboard 에서 확인·충전할 수 있습니다. 또는 orbitcrew 크레딧을 충전하면 그 크레딧으로 실행됩니다.';
  }
  if (status === 401 || lower.includes('invalid x-api-key') || lower.includes('authentication_error')) {
    return 'Anthropic API 키가 올바르지 않거나 만료되었습니다. 설정에서 키를 다시 등록해 주세요.';
  }
  if (status === 403 || lower.includes('permission_error')) {
    return '이 Anthropic API 키로는 요청한 모델을 쓸 수 없습니다. 키의 권한이나 모델 접근 설정을 확인해 주세요.';
  }
  if (status === 429 || lower.includes('rate_limit')) {
    return 'Anthropic API 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.';
  }
  if (status === 529 || lower.includes('overloaded')) {
    return 'Anthropic API 가 혼잡합니다. 잠시 뒤 다시 시도해 주세요.';
  }
  if (status === 404 || lower.includes('not_found_error')) {
    return '요청한 모델을 찾을 수 없습니다. 에이전트의 모델 설정을 확인해 주세요.';
  }
  return text || `Claude API 호출에 실패했습니다. (HTTP ${status})`;
}

/** 연결한 본인 키의 Anthropic 계정 잔액이 바닥난 경우. 라우트는 402 { code: 'provider_credits' } 로, 대화 화면은 충전 안내창으로 바꿉니다. */
export class ProviderCreditsError extends Error {
  status = 402;
  code = 'provider_credits' as const;
}

export function isProviderCreditsMessage(message: string | undefined): boolean {
  const lower = (message ?? '').toLowerCase();
  return lower.includes('credit balance is too low') || lower.includes('insufficient credit');
}

/** Anthropic 응답 오류를 던질 Error 로 — 잔액 부족은 종류를 구분할 수 있게 ProviderCreditsError. */
export function toProviderError(status: number, message: string | undefined): Error {
  const text = describeProviderError(status, message);
  return isProviderCreditsMessage(message) ? new ProviderCreditsError(text) : new Error(text);
}

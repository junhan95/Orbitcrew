import { expect, it } from 'vitest';
import { describeProviderError } from '@/lib/provider-errors';

it('Anthropic 잔액 부족은 본인 키 계정 문제임과 두 가지 해결책을 한글로 안내합니다', () => {
  const text = describeProviderError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
  expect(text).toContain('Anthropic API 키의 계정 잔액');
  expect(text).toContain('platform.claude.com/dashboard');
  expect(text).toContain('orbitcrew 크레딧');
});

it('인증·한도·혼잡 오류를 상태 코드로 구분합니다', () => {
  expect(describeProviderError(401, 'invalid x-api-key')).toContain('키가 올바르지 않');
  expect(describeProviderError(429, 'rate_limit_error')).toContain('한도');
  expect(describeProviderError(529, 'Overloaded')).toContain('혼잡');
});

it('모르는 오류는 원문을, 원문도 없으면 상태 코드를 보여 줍니다', () => {
  expect(describeProviderError(500, 'something odd')).toBe('something odd');
  expect(describeProviderError(502, undefined)).toBe('Claude API 호출에 실패했습니다. (HTTP 502)');
});

it('잔액 부족만 ProviderCreditsError 로 구분합니다', async () => {
  const { ProviderCreditsError, toProviderError } = await import('@/lib/provider-errors');
  expect(toProviderError(400, 'Your credit balance is too low to access the Anthropic API.')).toBeInstanceOf(ProviderCreditsError);
  expect(toProviderError(429, 'rate_limit_error')).not.toBeInstanceOf(ProviderCreditsError);
});

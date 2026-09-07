import { expect, it } from 'vitest';
import { requiresFileDeliverable } from '@/lib/deliverable-rules';

it('형식·확장자·파일 저장 지시가 있으면 파일 산출물을 요구하는 카드로 봅니다', () => {
  expect(requiresFileDeliverable('요약 보고서 작성', '결과는 워드(.doc)로 저장')).toBe(true);
  expect(requiresFileDeliverable('주간 보고서 초안 작성 (report.md)', '')).toBe(true);
  expect(requiresFileDeliverable('브로슈어 정리', '파일로 저장하고 요약만 보고')).toBe(true);
});

it('검토·QA 카드와 형식 언급이 없는 카드는 제외합니다', () => {
  expect(requiresFileDeliverable('요약 보고서 초안 QA 검토', '워드 파일 초안을 검토')).toBe(false);
  expect(requiresFileDeliverable('현황 파악', '팀 상황을 정리해 알려 주세요')).toBe(false);
});

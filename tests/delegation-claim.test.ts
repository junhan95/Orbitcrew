import { expect, it } from 'vitest';
import { claimsDelegation } from '@/lib/chat-agent';

const team = ['Mira', 'Lint 2'];

it('팀원 이름 + 위임 표현이 함께 있으면 위임 주장으로 봅니다', () => {
  expect(claimsDelegation('이 부분들을 근거로 Lint 2(QA)에게 아래 작업을 새로 위임했습니다.', team)).toBe(true);
  expect(claimsDelegation('Mira(리서처)에게 조사를 맡겼습니다.', team)).toBe(true);
});

it('팀원 이름이 없거나 위임 표현이 없으면 주장이 아닙니다', () => {
  expect(claimsDelegation('Mira의 초안을 검토한 결과 세 가지 우려가 있습니다.', team)).toBe(false);
  expect(claimsDelegation('QA에게 위임했습니다.', team)).toBe(false);
  expect(claimsDelegation('', team)).toBe(false);
});

it('위임 예정·안내 문구만으로는 주장이 아닙니다', () => {
  expect(claimsDelegation('초안이 오면 Lint 2에게 검증을 맡길 예정입니다.', team)).toBe(false);
});

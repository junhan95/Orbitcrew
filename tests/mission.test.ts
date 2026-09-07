import { expect, it } from 'vitest';
import { deriveMissionTitle, missionStatusOf } from '@/lib/mission';

it('첫 줄에서 제목을 만들고 60자에서 자릅니다', () => {
  expect(deriveMissionTitle('# 개인용 무료 할 일 관리 도구 3개를 조사해 줘.\n\n세부 조건…')).toBe('개인용 무료 할 일 관리 도구 3개를 조사해 줘.');
  expect(deriveMissionTitle('가'.repeat(80))).toHaveLength(60);
  expect(deriveMissionTitle('   ')).toBe('새 임무');
});

it('팀원 카드 상태로 임무 상태를 정합니다', () => {
  expect(missionStatusOf([])).toBeNull();
  expect(missionStatusOf(['대기', '검토 완료'])).toBe('진행 중');
  expect(missionStatusOf(['진행 중'])).toBe('진행 중');
  expect(missionStatusOf(['검토 중', '검토 완료'])).toBe('검토 중');
  expect(missionStatusOf(['검토 완료', '검토 완료'])).toBe('검토 완료');
});

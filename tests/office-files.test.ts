import { expect, it } from 'vitest';
import { isOfficePath, parseSlides, splitSheets } from '@/lib/office-files';

it('오피스 확장자를 알아봅니다', () => {
  expect(isOfficePath('보고서.docx')).toBe(true);
  expect(isOfficePath('a/b/표.XLSX')).toBe(true);
  expect(isOfficePath('발표.pptx')).toBe(true);
  expect(isOfficePath('보고서.doc')).toBe(false);
  expect(isOfficePath('report.md')).toBe(false);
});

it('CSV 를 시트 구분 줄로 나눕니다', () => {
  const sheets = splitSheets('## 시트: 매출\n월,금액\n1,10\n## Sheet: 비용\n월,금액\n1,3');
  expect(sheets.map((s) => s.name)).toEqual(['매출', '비용']);
  expect(sheets[0].csv).toBe('월,금액\n1,10');
  expect(splitSheets('a,b\n1,2')).toEqual([{ name: 'Sheet1', csv: 'a,b\n1,2' }]);
});

it('마크다운 슬라이드를 제목·불릿·본문·노트로 나눕니다', () => {
  const slides = parseSlides('# 개요\n- 첫째\n- 둘째\n> 발표자 메모\n---\n## 결론\n본문 한 줄');
  expect(slides).toHaveLength(2);
  expect(slides[0]).toMatchObject({ title: '개요', bullets: ['첫째', '둘째'], notes: '발표자 메모\n' });
  expect(slides[1]).toMatchObject({ title: '결론', body: ['본문 한 줄'] });
});

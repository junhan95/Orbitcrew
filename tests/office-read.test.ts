// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { renderOfficeFile } from '@/lib/office-files';
import { extractOfficeText, isOfficeTextSource } from '@/lib/office-read';

it('오피스 첨부 대상 확장자를 알아봅니다', () => {
  expect(isOfficeTextSource('a.docx')).toBe(true);
  expect(isOfficeTextSource('a.XLSX')).toBe(true);
  expect(isOfficeTextSource('a.pptx')).toBe(true);
  expect(isOfficeTextSource('a.pdf')).toBe(false);
});

it('만든 .docx / .xlsx / .pptx 에서 텍스트를 다시 뽑습니다', async () => {
  const docx = await renderOfficeFile('보고서.docx', '<html><body><h1>제목</h1><p>본문 <b>강조</b></p><ul><li>항목</li></ul></body></html>');
  const docxText = await extractOfficeText(new File([docx!], '보고서.docx'));
  expect(docxText).toContain('제목');
  expect(docxText).toContain('본문 강조');
  expect(docxText).toContain('항목');

  const xlsx = await renderOfficeFile('표.xlsx', '## 시트: 매출\n월,금액\n1,10');
  const xlsxText = await extractOfficeText(new File([xlsx!], '표.xlsx'));
  expect(xlsxText).toContain('## 시트: 매출');
  expect(xlsxText).toContain('1,10');

  const pptx = await renderOfficeFile('발표.pptx', '# 개요\n- 하나\n---\n# 결론\n끝');
  const pptxText = await extractOfficeText(new File([pptx!], '발표.pptx'));
  expect(pptxText).toContain('## 슬라이드 1');
  expect(pptxText).toContain('개요');
  expect(pptxText).toContain('결론');
}, 30_000);

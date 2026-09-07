// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { renderOfficeFile } from '@/lib/office-files';

const HTML = `<html><head><title>테스트 보고서</title><style>h1{color:red}</style></head><body>
<h1>테스트 보고서</h1>
<div class="docinfo"><b>작성일:</b> 2026-09-07<br><b>작성 에이전트:</b> Coco</div>
<h2>요약</h2>
<ul><li>첫째 <b>강조</b></li><li>둘째<ul><li>중첩</li></ul></li></ul>
<table><tr><th>항목</th><th>값</th></tr><tr><td>A</td><td>1</td></tr></table>
<p>본문 <i>기울임</i> 문장.</p>
</body></html>`;

it('HTML 을 실제 .docx(zip) 로 변환합니다', async () => {
  const blob = await renderOfficeFile('보고서.docx', HTML);
  expect(blob).not.toBeNull();
  const bytes = new Uint8Array(await blob!.arrayBuffer());
  expect(bytes.length).toBeGreaterThan(1000);
  expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
});

it('CSV 를 .xlsx 로, 마크다운 슬라이드를 .pptx 로 변환합니다', async () => {
  const xlsx = await renderOfficeFile('표.xlsx', '## 시트: 매출\n월,금액\n1,10\n## 시트: 비용\n월,금액\n1,3');
  expect(new Uint8Array(await xlsx!.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  const pptx = await renderOfficeFile('발표.pptx', '# 개요\n- 하나\n- 둘\n> 메모\n---\n## 결론\n마무리');
  expect(new Uint8Array(await pptx!.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
}, 30_000);

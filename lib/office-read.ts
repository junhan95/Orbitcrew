/**
 * 오피스 파일에서 텍스트 뽑기 (브라우저) — 대화 첨부용.
 *
 *   .docx → word/document.xml 의 문단 텍스트
 *   .pptx → ppt/slides/slideN.xml 의 텍스트 (슬라이드별로 구분)
 *   .xlsx / .xls → 시트별 CSV
 *
 * 파일 자체는 모델에 보내지 않고, 뽑은 텍스트만 첨부 텍스트 블록으로 전달합니다.
 */

const OFFICE_TEXT_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'xls']);

export function isOfficeTextSource(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return OFFICE_TEXT_EXTENSIONS.has(ext);
}

function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code))).replace(/&amp;/g, '&');
}

/** OOXML 조각에서 문단 단위 텍스트를 뽑습니다. `<w:p>`/`<a:p>` 는 줄바꿈, `<w:tab/>` 는 탭, 셀은 ' | ' 로. */
function paragraphsOf(xml: string, kind: 'word' | 'slide'): string {
  const p = kind === 'word' ? 'w:p' : 'a:p';
  const t = kind === 'word' ? 'w:t' : 'a:t';
  const rowClose = kind === 'word' ? '</w:tr>' : '</a:tr>';
  const cellClose = kind === 'word' ? '</w:tc>' : '</a:tc>';
  let out = '';
  const body = xml
    .replace(new RegExp(`<${p === 'w:p' ? 'w:tab' : 'a:tab'}\\s*/>`, 'g'), '\t')
    .replace(new RegExp(`<${kind === 'word' ? 'w:br' : 'a:br'}\\s*/>`, 'g'), '\n')
    .split(new RegExp(`</${p}>`));
  for (const chunk of body) {
    const texts = [...chunk.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([^<]*)</${t}>`, 'g'))].map((m) => decodeXml(m[1]));
    const line = texts.join('');
    const marker = chunk.includes(cellClose) ? ' | ' : '';
    out += line + marker + (chunk.includes(rowClose) ? '\n' : '\n');
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractOfficeText(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const buffer = await file.arrayBuffer();
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    return workbook.SheetNames.map((name) => `## 시트: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join('\n\n').trim();
  }
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  if (ext === 'docx') {
    const document = await zip.file('word/document.xml')?.async('string');
    if (!document) throw new Error('word/document.xml 이 없습니다.');
    return paragraphsOf(document, 'word');
  }
  if (ext === 'pptx') {
    const slides = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0));
    const parts: string[] = [];
    for (const [index, path] of slides.entries()) {
      const xml = await zip.file(path)?.async('string');
      if (!xml) continue;
      parts.push(`## 슬라이드 ${index + 1}\n${paragraphsOf(xml, 'slide')}`);
    }
    return parts.join('\n\n').trim();
  }
  throw new Error('지원하지 않는 형식입니다.');
}

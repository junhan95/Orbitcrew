/**
 * 오피스 파일 변환 (브라우저).
 *
 * 에이전트는 텍스트만 만들 수 있으므로 산출물의 "원본" 은 텍스트로 저장되고(task_files·save_project_file),
 * 실제 Word·Excel·PowerPoint 파일은 브라우저가 이 모듈로 변환해 사용자 폴더에 저장하거나 내려받습니다.
 *
 *   .docx ← HTML 전체 문서 (h1~h3 · p · ul/ol · table · b/i/br)
 *   .xlsx ← CSV (여러 시트는 `## 시트: 이름` 줄로 구분)
 *   .pptx ← 마크다운 슬라이드 (`---` 로 슬라이드 구분, `# 제목`, `- 불릿`, 그 외 줄은 본문)
 *
 * 변환 라이브러리(docx · xlsx · pptxgenjs)는 필요할 때만 동적으로 불러옵니다.
 */

export const OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx'] as const;
export type OfficeExtension = (typeof OFFICE_EXTENSIONS)[number];

export function officeExtensionOf(path: string): OfficeExtension | null {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return (OFFICE_EXTENSIONS as readonly string[]).includes(ext) ? ext as OfficeExtension : null;
}

export function isOfficePath(path: string): boolean {
  return officeExtensionOf(path) !== null;
}

export const OFFICE_MIME: Record<OfficeExtension, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** 텍스트 원본을 실제 오피스 파일(Blob)로 변환합니다. 오피스 확장자가 아니면 null. */
export async function renderOfficeFile(path: string, source: string): Promise<Blob | null> {
  const ext = officeExtensionOf(path);
  if (!ext) return null;
  if (ext === 'docx') return htmlToDocx(source);
  if (ext === 'xlsx') return csvToXlsx(source);
  return markdownToPptx(source);
}

/** 브라우저 다운로드로 내려받습니다 — 운영체제가 Word·Excel·PowerPoint 로 엽니다. */
export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.split('/').pop() ?? fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── .docx ────────────────────────────────────────────────────────────────────

type DocxModule = typeof import('docx');

async function htmlToDocx(html: string): Promise<Blob> {
  const docx: DocxModule = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = docx;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const title = parsed.querySelector('title')?.textContent?.trim();
  const blocks: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];

  const runsOf = (node: Node, style: { bold?: boolean; italics?: boolean } = {}): InstanceType<typeof TextRun>[] => {
    const out: InstanceType<typeof TextRun>[] = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ');
        if (text.trim()) out.push(new TextRun({ text, bold: style.bold, italics: style.italics }));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === 'br') { out.push(new TextRun({ text: '', break: 1 })); return; }
      if (tag === 'script' || tag === 'style') return;
      const next = { bold: style.bold || tag === 'b' || tag === 'strong', italics: style.italics || tag === 'i' || tag === 'em' };
      out.push(...runsOf(element, next));
    });
    return out;
  };

  const paragraph = (node: Node, options: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; bullet?: number; numbered?: boolean } = {}) => {
    const runs = runsOf(node);
    if (!runs.length && !options.heading) return;
    blocks.push(new Paragraph({
      children: runs.length ? runs : [new TextRun({ text: node.textContent?.trim() ?? '' })],
      heading: options.heading,
      bullet: options.bullet !== undefined ? { level: options.bullet } : undefined,
      spacing: { after: 120 },
    }));
  };

  const walk = (node: Node, depth = 0) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent ?? '').trim()) paragraph(child);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'head') return;
      if (tag === 'h1') return paragraph(element, { heading: HeadingLevel.HEADING_1 });
      if (tag === 'h2') return paragraph(element, { heading: HeadingLevel.HEADING_2 });
      if (tag === 'h3' || tag === 'h4') return paragraph(element, { heading: HeadingLevel.HEADING_3 });
      if (tag === 'p') return paragraph(element);
      if (tag === 'ul' || tag === 'ol') {
        element.querySelectorAll(':scope > li').forEach((item) => {
          // 중첩 목록은 자식으로 다시 걷고, li 자체의 텍스트만 불릿으로.
          const clone = item.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove());
          paragraph(clone, { bullet: Math.min(depth, 2) });
          item.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
            const wrapper = parsed.createDocumentFragment();
            wrapper.appendChild(nested.cloneNode(true));
            walk(wrapper, depth + 1);
          });
        });
        return;
      }
      if (tag === 'table') {
        const rows = Array.from(element.querySelectorAll('tr')).map((row) => new TableRow({
          children: Array.from(row.querySelectorAll('th, td')).map((cell) => new TableCell({
            children: [new Paragraph({ children: runsOf(cell, { bold: cell.tagName.toLowerCase() === 'th' }) })],
          })),
        }));
        if (rows.length) blocks.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        blocks.push(new Paragraph({ children: [] }));
        return;
      }
      if (tag === 'hr') { blocks.push(new Paragraph({ children: [] })); return; }
      if (tag === 'pre') { paragraph(element); return; }
      // div · section · article · body 등은 안으로 들어갑니다. 자식 블록이 없는 인라인 덩어리는 문단으로.
      const hasBlockChildren = Array.from(element.children).some((c) => /^(p|h[1-6]|ul|ol|table|div|section|article|pre|hr|blockquote)$/i.test(c.tagName));
      if (hasBlockChildren) walk(element, depth); else paragraph(element);
    });
  };
  walk(parsed.body);

  const document = new Document({
    title: title ?? undefined,
    styles: { default: { document: { run: { font: 'Malgun Gothic', size: 22 } } } },
    sections: [{ properties: {}, children: blocks.length ? blocks : [new Paragraph({ children: [new TextRun({ text: parsed.body.textContent?.trim() ?? '' })], alignment: AlignmentType.LEFT })] }],
  });
  return Packer.toBlob(document);
}

// ── .xlsx ────────────────────────────────────────────────────────────────────

async function csvToXlsx(source: string): Promise<Blob> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const sections = splitSheets(source);
  for (const section of sections) {
    const parsed = XLSX.read(section.csv, { type: 'string', raw: false });
    const sheet = parsed.Sheets[parsed.SheetNames[0]];
    XLSX.utils.book_append_sheet(workbook, sheet, section.name.slice(0, 31) || 'Sheet1');
  }
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([bytes], { type: OFFICE_MIME.xlsx });
}

/** `## 시트: 이름` / `## Sheet: name` 줄로 시트를 나눕니다. 구분이 없으면 시트 하나. */
export function splitSheets(source: string): Array<{ name: string; csv: string }> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ name: string; csv: string[] }> = [];
  for (const line of lines) {
    const match = line.match(/^##\s*(?:시트|sheet)\s*[:：]\s*(.+)$/i);
    if (match) { sections.push({ name: match[1].trim(), csv: [] }); continue; }
    if (!sections.length) sections.push({ name: 'Sheet1', csv: [] });
    sections[sections.length - 1].csv.push(line);
  }
  return sections.map((section) => ({ name: section.name, csv: section.csv.join('\n').trim() })).filter((section) => section.csv);
}

// ── .pptx ────────────────────────────────────────────────────────────────────

export type SlideSpec = { title: string; bullets: string[]; body: string[]; notes: string };

/** `---` 로 나눈 마크다운 슬라이드를 구조로 바꿉니다. */
export function parseSlides(source: string): SlideSpec[] {
  return source.replace(/\r\n/g, '\n').split(/^\s*---\s*$/m).map((chunk) => {
    const slide: SlideSpec = { title: '', bullets: [], body: [], notes: '' };
    for (const raw of chunk.split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading && !slide.title) { slide.title = heading[1].trim(); continue; }
      const note = line.match(/^>\s?(.*)$/);
      if (note) { slide.notes += `${note[1]}\n`; continue; }
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bullet) { slide.bullets.push(bullet[1].trim()); continue; }
      slide.body.push(line.trim());
    }
    return slide;
  }).filter((slide) => slide.title || slide.bullets.length || slide.body.length);
}

async function markdownToPptx(source: string): Promise<Blob> {
  const pptxModule = await import('pptxgenjs');
  const PptxGenJS = (pptxModule.default ?? pptxModule) as unknown as new () => PptxGen;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const slides = parseSlides(source);
  for (const spec of slides.length ? slides : [{ title: '', bullets: [], body: [source.trim()], notes: '' }]) {
    const slide = pptx.addSlide();
    if (spec.title) slide.addText(spec.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 28, bold: true, fontFace: 'Malgun Gothic', color: '1A3D6D' });
    const lines: Array<{ text: string; options?: Record<string, unknown> }> = [
      ...spec.body.map((text) => ({ text, options: { breakLine: true } })),
      ...spec.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    ];
    if (lines.length) slide.addText(lines, { x: 0.5, y: 1.4, w: 9, h: 3.8, fontSize: 18, fontFace: 'Malgun Gothic', color: '222222', valign: 'top' });
    if (spec.notes.trim()) slide.addNotes(spec.notes.trim());
  }
  const blob = await pptx.write({ outputType: 'blob' });
  return blob instanceof Blob ? blob : new Blob([blob as BlobPart], { type: OFFICE_MIME.pptx });
}

/** pptxgenjs 의 최소 타입 (패키지 타입이 default export 와 어긋나는 경우가 있어 직접 적습니다) */
type PptxGen = {
  layout: string;
  addSlide(): {
    addText(text: string | Array<{ text: string; options?: Record<string, unknown> }>, options: Record<string, unknown>): void;
    addNotes(text: string): void;
  };
  write(options: { outputType: 'blob' }): Promise<Blob | ArrayBuffer | Uint8Array | string>;
};

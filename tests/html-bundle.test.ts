// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bundleHtml, resolveRelative } from '@/lib/html-bundle';

it('HTML 위치 기준으로 상대 경로를 풉니다', () => {
  expect(resolveRelative('index.html', 'style.css')).toBe('style.css');
  expect(resolveRelative('app/index.html', './js/main.js')).toBe('app/js/main.js');
  expect(resolveRelative('app/index.html', '../shared.css?v=2')).toBe('shared.css');
  expect(resolveRelative('index.html', '../out.css')).toBeNull();
  expect(resolveRelative('index.html', 'https://cdn.example.com/x.js')).toBeNull();
  expect(resolveRelative('index.html', '//cdn.example.com/x.js')).toBeNull();
  expect(resolveRelative('index.html', 'data:text/css,a{}')).toBeNull();
});

it('CSS·JS 를 인라인하고 없는 자원과 절대 URL 은 그대로 둡니다', async () => {
  const files: Record<string, string> = { 'style.css': 'body{color:red}', 'script.js': "console.log('</script>')" };
  const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css"><link rel="icon" href="fav.ico"><script src="https://cdn.example.com/lib.js"></script></head><body><script src="./script.js" defer></script><script src="missing.js"></script></body></html>`;
  const out = await bundleHtml(html, 'index.html', async (path) => (path in files ? new Blob([files[path]]) : null));
  expect(out).toContain('<style>\nbody{color:red}\n</style>');
  expect(out).toContain('<script defer>\nconsole.log(\'<\\/script>\')\n</script>');
  expect(out).toContain('<script src="https://cdn.example.com/lib.js"></script>');
  expect(out).toContain('<script src="missing.js"></script>');
  expect(out).toContain('<link rel="icon" href="fav.ico">');
});

it('이미지는 data: URL 로 바꿉니다', async () => {
  const out = await bundleHtml('<img src="logo.png" alt="x">', 'index.html', async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  expect(out).toMatch(/^<img src="data:image\/png;base64,AQID" alt="x">$/);
});

import { type NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db';
import { SESSION_COOKIE, authMode, findSessionUser } from '@/lib/auth';

/**
 * 호스트 분리 + 로그인 게이트
 *
 * 1) 호스트 분리 (LANDING_URL 이 설정된 운영 환경에서만):
 *     - 랜딩 호스트(orbitcrew.ai):  /  → /landing 으로 내부 rewrite (주소창은 / 유지)
 *                                   /landing → / 로 정규화, 그 외 앱 경로(/login, /api/*) → APP_URL 로 리디렉션
 *     - www.  → 랜딩 호스트로 리디렉션
 *     - 앱 호스트(app.orbitcrew.ai): /landing → LANDING_URL 로 리디렉션 (로그아웃 후 이동 포함)
 *    LANDING_URL 이 없으면(로컬·workers.dev) 예전처럼 한 호스트에서 /landing 과 앱을 같이 냅니다.
 *
 * 2) 로그인 게이트
 *     - 로컬 모드: 아무것도 하지 않습니다 (예전과 동일).
 *     - OAuth 모드:
 *         /landing, /login, /api/auth/*  → 공개
 *         /login 을 이미 로그인한 채로 열면 → /
 *         그 외 페이지는 세션 없음 → /login,  API 는 세션 없음 → 401
 *         세션이 있으면 x-orbit-* 헤더로 사용자를 실어 보냅니다 (app/auth.ts 가 읽음).
 *
 * 들어온 요청의 x-orbit-* 는 먼저 지웁니다 — 바깥에서 꽂아 넣은 값을 믿지 않기 위해서입니다.
 */
const FORWARDED = ['x-orbit-uid', 'x-orbit-name', 'x-orbit-email', 'x-orbit-avatar'];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/** 랜딩/앱 호스트 분리. 해당 없으면 null 을 돌려주고 다음 단계로 넘어갑니다. */
function splitHosts(request: NextRequest): NextResponse | null {
  const landingHost = hostOf(env.LANDING_URL);
  if (!landingHost) return null;
  const landingOrigin = env.LANDING_URL!.replace(/\/$/, '');
  const appOrigin = (env.APP_URL || '').replace(/\/$/, '');
  const host = (request.headers.get('host') || request.nextUrl.hostname).toLowerCase().split(':')[0];
  const { pathname, search } = request.nextUrl;

  // 운영에서는 평문 HTTP 를 HTTPS 로 올립니다 (Cloudflare 'Always Use HTTPS' 와 무관하게 보장).
  if (request.nextUrl.protocol === 'http:' && host !== 'localhost') {
    return NextResponse.redirect(`https://${host}${pathname}${search}`, 308);
  }

  if (host === `www.${landingHost}`) {
    return NextResponse.redirect(`${landingOrigin}${pathname === '/landing' ? '/' : pathname}${search}`, 308);
  }
  if (host === landingHost) {
    if (pathname === '/') return NextResponse.rewrite(new URL('/landing', request.url));
    if (pathname === '/landing') return NextResponse.redirect(`${landingOrigin}/${search}`, 308);
    if (appOrigin) return NextResponse.redirect(`${appOrigin}${pathname}${search}`, pathname.startsWith('/api/') ? 308 : 302);
    return null;
  }
  // 앱 호스트(또는 그 외): 랜딩은 랜딩 호스트로 보냅니다.
  if (pathname === '/landing') return NextResponse.redirect(`${landingOrigin}/`, 302);
  return null;
}

export async function proxy(request: NextRequest) {
  const split = splitHosts(request);
  if (split) return split;

  if (authMode() === 'local') return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = pathname === '/landing' || pathname === '/login' || pathname.startsWith('/api/auth/')
  // Office 앱이 문서를 받아 가는 경로 — 무작위 id 가 곧 열쇠이고 1시간 뒤 사라집니다 (올리는 POST 는 로그인 필요).
  || (pathname.startsWith('/api/open-files/') && request.method !== 'POST');

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await findSessionUser(getDatabase(), token) : null;

  if (pathname === '/login' && user) return NextResponse.redirect(new URL('/', request.url));
  if (isPublic) return NextResponse.next();

  if (!user) {
    if (isApi) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  const forwarded = new Headers(request.headers);
  for (const name of FORWARDED) forwarded.delete(name);
  forwarded.set('x-orbit-uid', user.userId);
  forwarded.set('x-orbit-name', encodeURIComponent(user.displayName));
  forwarded.set('x-orbit-email', encodeURIComponent(user.email));
  if (user.avatarUrl) forwarded.set('x-orbit-avatar', encodeURIComponent(user.avatarUrl));
  return NextResponse.next({ request: { headers: forwarded } });
}

/** 정적 자산·Vite 내부 경로는 건드리지 않도록 앱 경로만 명시합니다. */
export const config = {
  matcher: ['/', '/login', '/landing', '/api/:path*'],
};

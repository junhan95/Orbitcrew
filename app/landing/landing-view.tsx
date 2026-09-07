'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OrbitMark } from '@/components/orbit-mark';
import { COMPANY, LEGAL_LINKS } from '@/lib/legal';

/**
 * orbitcrew 랜딩페이지.
 *
 * 테마: 우주(항상 다크). 레이아웃은 Figma 커뮤니티 Launch UI 랜딩 템플릿의 히어로 구성
 * (중앙 정렬 헤드라인 → 지평선 글로우 → 그 위로 떠오르는 앱 목업)을 따르고, 팔레트는
 * Launch UI ultraviolet 토큰(#09090b / #fafafa / Indigo 600 / Violet 400)에
 * 브랜드 노랑(#ffd02f)을 별빛처럼 소량 얹었습니다. 시스템 라이트/다크와 무관하게 항상 다크입니다
 * (앱 쪽 --c-* 토큰은 쓰지 않습니다 — 랜딩 전용 --lp-* 값만 씁니다).
 *
 * 언어: 영어(기본) / 한국어. 두 언어 트리를 모두 렌더해 두고 루트의 data-lang 으로 하나만
 * 보입니다(CSS). 그래서 정적 빌드(scripts/build-landing.mjs, React 없음)에서도 같은 토글이
 * 동작합니다 — 전환·저장(localStorage 'orbit-landing-lang')은 enhanceLanding() 이 맡습니다.
 * 앵커 id 는 영어 트리가 원본(#features), 한국어 트리는 ko- 접두(#ko-features)를 씁니다.
 *
 * 섹션: 고객 성과 → 문제 공감 → AI 모델·오케스트레이션 → 무료 이용 조건 → 핵심 강점
 *       → 작동 방식 → 크루 → 시작 안내 → FAQ → CTA → 푸터
 *
 * 요금 카피는 docs/pricing-credits.md 를 따릅니다 — 개인은 크레딧 종량제(가입 시 300 크레딧, 1 크레딧 = 10원),
 * 본인 Claude API 키를 연결하면 무료(BYOK). 팀 플랜은 준비 중, 기업은 셀프호스팅 문의.
 *
 * 스타일은 globals.css 를 건드리지 않도록 이 파일 안에 가둡니다(.lp 스코프).
 *
 * 모션: 스크롤 등장(.lp-reveal)은 enhanceLanding() 이 JS 로 켭니다. JS 가 없으면
 * 전부 보이는 상태가 기본이라 정적 빌드·검색엔진에서도 내용이 빠지지 않습니다.
 */

export type LandingLang = 'en' | 'ko';
export const LANDING_LANGS: LandingLang[] = ['en', 'ko'];

/* ─────────────────────────────────────────────────────────── */
/* 사전                                                          */
/* ─────────────────────────────────────────────────────────── */

type IconName = 'key' | 'lock' | 'login' | 'code' | 'globe' | 'chart' | 'board' | 'chat' | 'check';
type ArtKind = 'manager' | 'memory' | 'recall' | 'verify' | 'gate' | 'band';
type Tone = 'brand' | 'mint' | 'ink' | 'coral' | 'dash';
type Span = 'lp-b-7' | 'lp-b-5' | 'lp-b-4' | 'lp-b-12';

interface Dict {
  nav: { label: string; id: string }[];
  openApp: string;
  /** 베타 배지 — 앱으로 들어가는 CTA 마다 붙습니다 (docs/pricing-credits.md §10) */
  beta: string;
  betaBanner: { t: string; d: string };
  menu: string;
  langLabel: string;
  eyebrow: string;
  h1a: string;
  h1b: string;
  h1accent: string;
  heroSub: string;
  ctaStart: string;
  ctaTour: string;
  facts: { n: string; l: string }[];
  factsLabel: string;
  trust: { icon: IconName; t: string; d: string }[];
  trustLabel: string;
  product: { eyebrow: string; h: string; p: string; notes: { icon: IconName; t: string; d: string }[] };
  about: { a: string; b: string; p: string; more: string };
  features: { eyebrow: string; h: string; items: { k: string; t: string; d: string; span: Span; art: ArtKind }[] };
  how: { eyebrow: string; h: string; steps: { n: string; t: string; d: string; chip: string }[]; convoLabel: string };
  convo: { me: string; user: string; pm: string; pmMsg: string; card1: string; card1meta: string; card2: string; card2meta: string; reviewer: string; reviewMsg: string };
  crew: { eyebrow: string; h: string; p: string; items: { role: string; tag: string; d: string; tone: Tone }[] };
  compare: { eyebrow: string; h: string; colLabel: string; cols: string[]; rows: { k: string; v: string[] }[] };
  pricing: {
    eyebrow: string; h: string; p: string;
    plans: { name: string; price: string; unit: string; d: string; perks: string[]; cta: string; href: string; tag?: string; featured?: boolean }[];
    note: string; noteLink: string; rateNote: string;
  };
  start: { eyebrow: string; h: string; p1: string; p2: string; p3: string; perks: string[]; cta: string; steps: { n: string; t: string; d: string }[] };
  faq: { eyebrow: string; h: string; items: { q: string; a: string }[] };
  cta: { a: string; b: string; p: string; btn: string };
  footer: { tag: string; product: string; legal: string; contact: string; legalLine: string; navLabel: string; legalNavLabel: string };
  art: { pm: string; roles: [string, string, string]; layers: [string, string, string, string]; approve: string; query: string; evidence: string; pending: string; alert: string };
  board: { cols: [string, string, string]; cards: { t: string; tag: 'high' | 'mid' | 'low'; who: string }[][]; tags: { high: string; mid: string; low: string } };
  mock: { url: string; side: string[]; title: string; project: string; focus: string; kpis: [string, string, string]; weekly: string; status: string; board: string; boardBy: string; cols: [string, string[]][]; chat: string; chatWho: string; msgU: string; msgA: string; input: string };
  orbitChips: [string, string, string];
}

const KO: Dict = {
  nav: [
    { label: '내 일이 달라지는 방식', id: 'product' },
    { label: '기능', id: 'features' },
    { label: '작동 방식', id: 'how' },
    { label: 'AI 모델', id: 'models' },
    { label: '요금', id: 'pricing' },
    { label: '시작하기', id: 'start' },
  ],
  openApp: '앱 열기',
  beta: 'BETA',
  betaBanner: {
    t: '베타 운영 중 — 충전해도 청구되지 않습니다',
    d: '베타 기간에는 결제창이 테스트 모드로 열려 카드 정보를 넣어도 실제로 결제되지 않습니다. 한 달에 5,000 크레딧까지 충전할 수 있고, 남은 베타 크레딧은 베타 종료 시 소멸됩니다. 본인 Claude API 키를 연결하면 크레딧이 바닥난 뒤에도 그 키로 이어서 씁니다.',
  },
  menu: '메뉴',
  langLabel: '언어',
  eyebrow: 'YOUR GOAL. YOUR AI CREW.',
  h1a: '혼자 하던 일에',
  h1b: 'AI 팀이',
  h1accent: '생깁니다',
  heroSub: '조사하고, 정리하고, 다시 확인하느라 미뤄둔 일. 목표만 알려주세요. AI 매니저가 팀을 꾸려 실행하고, 검토한 결과를 모아드립니다.',
  ctaStart: '내 AI 팀 만들기',
  ctaTour: '어떻게 맡기는지 보기',
  facts: [{ n: '목표를 전하면', l: '매니저가 일을 나누고' }, { n: '팀이 실행하고', l: '서로의 결과를 검토하고' }, { n: '나는 결정합니다', l: '결과를 보고 다음 방향을' }],
  factsLabel: '목표에서 결과까지',
  trust: [
    { icon: 'key', t: '가입 즉시 시작', d: '300 크레딧 무료 · 쓴 만큼만 결제' },
    { icon: 'lock', t: '본인 키면 무료', d: 'Claude API 키는 서버에서 암호화' },
    { icon: 'login', t: 'Google · GitHub 로그인', d: '별도 가입 절차 없음' },
    { icon: 'code', t: '오픈소스', d: 'AGPL-3.0 · 저장소 공개' },
    { icon: 'globe', t: '한국어 · English', d: '라이트 · 다크 테마' },
  ],
  trustLabel: '신뢰 요소',
  product: {
    eyebrow: 'PRODUCT',
    h: 'AI에게 물어본 뒤, 결국 내가 다 하고 있나요?',
    p: '답변을 옮기고, 배경을 다시 설명하고, 빠진 내용을 확인하는 일. 하나의 프로젝트 안에서 AI 팀이 이어받습니다.',
    notes: [
      { icon: 'chart', t: '대쉬보드', d: '집중 프로젝트 · 주간 처리량 · 검토 도달률' },
      { icon: 'board', t: 'TASK 보드', d: '담당자 · 상태 · 분류로 묶어 보기' },
      { icon: 'chat', t: '대화', d: '업무 카드에서 바로 ‘대화하기’' },
    ],
  },
  about: {
    a: '당신은 방향을.',
    b: '실행은 AI 팀이.',
    p: '경쟁사 조사부터 문서 초안까지. 매니저가 필요한 담당자를 모으고, 조사 결과를 작성자에게 연결하고, 검토자가 빠진 내용을 확인합니다. 당신은 결과를 보고 다음 방향을 결정하세요.',
    more: '더 알아보기',
  },
  features: {
    eyebrow: 'CAPABILITIES',
    h: '맡긴 뒤에도 안심할 수 있도록',
    items: [
      { k: '01', t: '업무를 나누는 수고를 덜어줍니다', d: '목표를 전하면 매니저가 필요한 역할을 찾고 일을 나눕니다. 담당자를 하나씩 만들고 지시할 필요가 줄어듭니다.', span: 'lp-b-7', art: 'manager' },
      { k: '02', t: '같은 배경을 반복해서 설명하지 마세요', d: '사용자와 프로젝트의 맥락을 기억합니다. 팀원이 달라져도 목표와 작업 기준을 이어갑니다.', span: 'lp-b-5', art: 'memory' },
      { k: '03', t: '지난 대화를 찾아 헤매지 마세요', d: '이전 실행과 대화에서 필요한 내용을 찾아 이어갑니다. 이미 정한 내용을 다시 모으는 수고를 덜어줍니다.', span: 'lp-b-4', art: 'recall' },
      { k: '04', t: '결과와 근거를 함께 확인하세요', d: '담당 AI가 남긴 결과를 다른 AI가 검토합니다. 누락된 근거와 수정할 부분을 확인한 뒤 판단할 수 있습니다.', span: 'lp-b-4', art: 'verify' },
      { k: '05', t: '중요한 결정은 당신에게 남깁니다', d: '승인이 필요한 작업은 승인함에 모입니다. 진행을 허용하거나 되돌리며 팀의 방향을 직접 잡을 수 있습니다.', span: 'lp-b-4', art: 'gate' },
      { k: '06', t: '막힌 일과 비용을 놓치지 마세요', d: '반복되는 실패와 평소와 다른 비용 흐름을 감지합니다. 모든 기록을 뒤지기 전에 살펴볼 곳을 알려줍니다.', span: 'lp-b-12', art: 'band' },
    ],
  },
  how: {
    eyebrow: 'HOW IT WORKS',
    h: '네 단계로 끝납니다',
    steps: [
      { n: '01', t: '목표를 말합니다', d: '대화창에 하고 싶은 일을 그대로 적습니다. 상태를 손으로 옮길 필요가 없습니다.', chip: '사용자' },
      { n: '02', t: '매니저가 팀을 짭니다', d: '직무 카탈로그에서 필요한 에이전트를 부르고, 없으면 새로 만들어 프로젝트에 합류시킵니다.', chip: '매니저' },
      { n: '03', t: '에이전트가 실행합니다', d: '기억과 회상을 안고 일하고, 근거를 붙여 구조화된 완료 보고를 남깁니다.', chip: '에이전트' },
      { n: '04', t: '검토하고 승인합니다', d: '작성자가 아닌 에이전트가 먼저 걸러내고, 마지막 판단만 사람이 합니다.', chip: '검토 → 사람' },
    ],
    convoLabel: '대화 예시',
  },
  convo: {
    me: '나',
    user: '경쟁사 세 곳 가격표 비교해서 다음 주 릴리스 노트 초안까지 만들어 줘.',
    pm: '프로젝트 매니저',
    pmMsg: '리서처와 작성자를 합류시켰습니다. 업무 2건을 만들었고, 조사 결과는 검토자가 먼저 봅니다.',
    card1: '경쟁사 가격표 조사', card1meta: '리서처 · 높음',
    card2: '릴리스 노트 초안', card2meta: '작성자 · 중간',
    reviewer: '검토자',
    reviewMsg: '조사 결과 근거 3건 확인. 스펙 패스에서 통화 단위 누락 1건을 돌려보냈습니다.',
  },
  crew: {
    eyebrow: 'THE CREW',
    h: '필요한 직무만큼 팀이 커집니다',
    p: '매니저는 직무 카탈로그에서 에이전트를 부르고, 없으면 역할과 실행 지침을 정의해 새로 만듭니다. 팀은 프로젝트마다 다르게 꾸려집니다.',
    items: [
      { role: '프로젝트 매니저', tag: '항상 배정', d: '지시를 읽고 팀을 꾸리고, 업무를 나누고, 보고를 검토해 사용자에게 안내합니다.', tone: 'brand' },
      { role: '리서처', tag: '카탈로그', d: '웹 검색과 연결 폴더를 뒤져 근거가 붙은 조사 결과를 냅니다.', tone: 'mint' },
      { role: '작성자', tag: '카탈로그', d: '문서·릴리스 노트·이메일 초안을 프로젝트 기억에 맞춰 씁니다.', tone: 'ink' },
      { role: '검토자', tag: '자동 합류', d: '버그·스펙·정책·근거 네 패스로 다른 에이전트의 결과를 거릅니다.', tone: 'coral' },
      { role: '데이터 분석가', tag: '카탈로그', d: '표와 수치를 읽고 요약과 다음 액션을 제안합니다.', tone: 'mint' },
      { role: '필요한 직무', tag: '자동 생성', d: '카탈로그에 없으면 매니저가 역할·지침을 정의해 새로 만듭니다.', tone: 'dash' },
    ],
  },
  compare: {
    eyebrow: 'WHY ORBITCREW',
    h: '챗봇도, 혼자 뛰는 에이전트도 아닙니다',
    colLabel: '항목',
    cols: ['일반 챗봇', '단일 에이전트', 'orbitcrew'],
    rows: [
      { k: '기억', v: ['대화 한 번', '세션 안에서만', '사용자·프로젝트·에이전트 4층 기억'] },
      { k: '팀 구성', v: ['없음', '한 명이 전부', '매니저가 직무별 에이전트 채용'] },
      { k: '완료 기준', v: ['답변이 오면 끝', '스스로 끝났다고 보고', '근거 없으면 완료 불가'] },
      { k: '검토', v: ['사람이 전부', '사람이 전부', '다른 에이전트가 4패스 선검토'] },
      { k: '비용 관제', v: ['알 수 없음', '실행 후 확인', '14일 기준선 밴드 이탈 시 자동 진단'] },
      { k: '사람의 역할', v: ['질문·복붙', '지시·상태 변경', '승인 · 거절 · 방향만'] },
    ],
  },
  pricing: {
    eyebrow: 'PRICING',
    h: '무료로 시작하고, 나에게 맞게 쓰세요',
    p: '개인은 크레딧을 충전해 AI 사용량만큼 씁니다. 광고도, 개인 월 정액도 없습니다. 팀과 기업은 필요한 만큼만 위로 올라갑니다.',
    plans: [
      {
        name: '개인', price: '쓴 만큼만', unit: '1 크레딧 = 10원 · 5,000원부터 충전',
        d: '가입 즉시 300 크레딧이 들어옵니다. 매니저가 팀을 꾸려 일하는 장면을 몇 번 겪어 보고, 마음에 들면 충전하세요.',
        perks: ['가입 즉시 300 크레딧 무료', '베타 기간 충전 무료 — 월 5,000 크레딧까지', '모델별 단가 공개 — 앱 안 단가표', '실측 토큰 · 크레딧 차감 내역', '정식 출시 후 미사용 유료 크레딧 환불'],
        cta: '무료로 시작', href: '/login', tag: '베타 · 충전 무료', featured: true,
      },
      {
        name: '팀', price: '준비 중', unit: '좌석당 · 가격 미정',
        d: '같은 프로젝트를 동료와 함께 보고, 매니저가 만든 카드를 나눠 받습니다.',
        perks: ['멤버 초대 · 프로젝트 공유', '공용 크레딧 풀', '권한 · 감사 로그', '개인 워크스페이스는 계속 무료'],
        cta: '대기 명단 등록', href: 'mailto:hello@orbitcrew.ai?subject=orbitcrew%20%ED%8C%80%20%ED%94%8C%EB%9E%9C%20%EB%8C%80%EA%B8%B0%20%EB%AA%85%EB%8B%A8', tag: '2단계',
      },
      {
        name: '기업', price: '셀프호스팅', unit: '귀사 서버 · 연 라이선스',
        d: '데이터가 밖으로 나가면 안 되는 조직을 위해 귀사 인프라에 설치하고 자체 키로 돌립니다.',
        perks: ['귀사 서버 설치 · 데이터 외부 반출 없음', '자체 Anthropic 키 · 사용량 통제', 'AGPL-3.0 또는 상용 라이선스', '도입 지원 · 우선 대응'],
        cta: '문의하기', href: 'mailto:hello@orbitcrew.ai?subject=orbitcrew%20%EA%B8%B0%EC%97%85%20%EC%85%80%ED%94%84%ED%98%B8%EC%8A%A4%ED%8C%85%20%EB%AC%B8%EC%9D%98',
      },
    ],
    note: '이미 Claude API 키가 있다면 연결해서 무료로 씁니다 — AI 사용 요금은 본인 Anthropic 계정으로 직접 냅니다.',
    noteLink: '키 연결 안내',
    rateNote: '크레딧 단가 = Anthropic 공개 단가 × 1.8 (부가세 포함). 예: Sonnet 5 대화 한 턴 약 3.5 크레딧.',
  },
  start: {
    eyebrow: 'GET STARTED',
    h: '가입하면 바로 시작됩니다',
    p1: 'API 키를 만들 필요가 없습니다. 로그인하면 ',
    p2: '300 크레딧',
    p3: '이 바로 들어오고, 프로젝트 이름만 정하면 매니저가 첫 업무를 만들어 옵니다. 더 쓰고 싶으면 그때 충전하고, Claude API 키가 있다면 연결해서 무료로 씁니다.',
    perks: [
      '가입 즉시 300 크레딧 — 카드 등록 없음',
      '월 구독 · 광고 없음, 쓴 만큼만 결제',
      '본인 Claude API 키를 연결하면 orbitcrew 는 무료',
      '오픈소스(AGPL-3.0) — 직접 배포도 가능',
    ],
    cta: '지금 시작하기',
    steps: [
      { n: '1', t: 'Google 또는 GitHub 로 로그인', d: '계정을 새로 만들지 않습니다. 첫 로그인이면 300 크레딧이 지급되고 짧은 안내가 한 번 나옵니다.' },
      { n: '2', t: '프로젝트 이름과 작업 폴더', d: '이것만 정하면 매니저가 배정되고 첫 업무를 만들어 옵니다.' },
      { n: '3', t: '더 쓰고 싶을 때 — 충전 또는 키 연결', d: '5,000원부터 충전하거나, Anthropic 계정의 API 키를 연결합니다. 베타 기간에는 충전이 테스트 결제로 처리돼 청구되지 않습니다(월 5,000 크레딧). 키는 서버에서 암호화돼 저장되고 그 키로 나가는 호출은 과금되지 않습니다.' },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    h: '자주 묻는 질문',
    items: [
      { q: '베타 기간에는 무엇이 다른가요?', a: '지금은 베타입니다. 충전 버튼을 누르면 토스페이먼츠 결제창이 테스트 모드로 열리고, 카드 정보를 넣어도 실제로 청구되지 않습니다. 사용자당 한 달에 5,000 크레딧까지 충전할 수 있고, 베타가 끝나면 남은 베타 크레딧은 소멸됩니다(정식 전환 시 감사 크레딧을 따로 드립니다). 본인 Claude API 키를 연결하면 한도와 무관하게 그 키로 실행됩니다. 베타 중에도 실제 사용량은 실측되어 내역에 그대로 남습니다.' },
      { q: '얼마인가요?', a: '월 구독은 없습니다. 가입하면 300 크레딧(3,000원 상당)이 무료로 들어오고, 그 뒤로는 쓴 만큼 크레딧이 차감됩니다. 1 크레딧은 10원이고 5,000원부터 충전합니다. 본인 Claude API 키를 연결하면 orbitcrew 는 무료이고 AI 요금은 Anthropic 에 직접 냅니다.' },
      { q: '크레딧은 어떻게 계산되나요?', a: '모델별 단가는 Anthropic 공개 단가의 1.8배(부가세 포함)이고, 앱 안 단가표에 모두 공개돼 있습니다. 예를 들어 Sonnet 5 로 대화 한 턴은 약 3.5 크레딧, 매니저가 하위 에이전트를 여럿 돌리는 실행 한 번은 대략 45~180 크레딧입니다. 호출마다 실측 토큰으로 차감되고 내역을 바로 볼 수 있습니다.' },
      { q: '충전한 크레딧은 환불되나요?', a: '유료로 충전한 크레딧의 미사용분은 환불됩니다(결제 취소 방식). 가입 시 받은 무료 크레딧과 보너스는 환불·양도되지 않습니다. 사용은 무료·보너스 크레딧부터 차감됩니다.' },
      { q: 'Claude API 키가 있으면 어떻게 되나요?', a: '계정 화면에서 키를 연결하면 크레딧을 먼저 쓰고, 잔액이 바닥나면 본인 키로 이어서 실행됩니다. 키로 나간 호출은 크레딧을 차감하지 않습니다. 키는 서버 측 마스터 시크릿으로 암호화해 저장하고 실행 시에만 복호화합니다. 키가 없는 사용자의 호출만 orbitcrew 의 운영 키로 나가며, 그 비용이 크레딧입니다.' },
      { q: 'Claude 계정으로 바로 로그인할 수 있나요?', a: '아니요. Anthropic 정책상 제3자 앱에서 Claude 계정 로그인은 제공되지 않습니다. 로그인은 Google · GitHub 로 하고, Claude 는 크레딧 또는 본인 API 키로 씁니다.' },
      { q: '내 컴퓨터의 파일에도 접근하나요?', a: '프로젝트에 폴더를 연결한 경우에만, 브라우저의 폴더 선택기로 허용한 범위 안에서 파일 목록과 내용을 업무 실행 컨텍스트로 전달합니다.' },
      { q: '에이전트가 마음대로 일을 벌이지는 않나요?', a: '대화창의 승인 레벨(자동 / 카드만 / 읽기 전용)로 매니저 자율도를 제한합니다. 카드를 많이 만들거나 전역 스킬을 저장하려 하면 승인 게이트로 넘어가고, 연속 실패는 서킷브레이커가 끊습니다.' },
      { q: '어떤 모델을 쓰나요?', a: '에이전트마다 Claude 모델을 골라 배정할 수 있고, 지정하지 않으면 기본 모델로 실행됩니다. 무료 크레딧만 있는 동안은 Haiku · Sonnet 으로 실행되고, 충전하면 상위 모델도 열립니다. 사용량 화면에서 토큰 실측과 크레딧 차감을 함께 봅니다.' },
      { q: '오픈소스인가요?', a: '네. AGPL-3.0 라이선스로 저장소가 공개돼 있습니다. 직접 배포해 쓰거나 코드를 살펴볼 수 있습니다.' },
    ],
  },
  cta: { a: '미뤄둔 일 하나,', b: '오늘 맡겨보세요.', p: '가입하면 300 크레딧 무료. 카드 등록 없이 첫 프로젝트를 시작하세요.', btn: '무료로 내 AI 팀 만들기' },
  footer: {
    tag: 'AI Agent Command Center',
    product: '제품',
    legal: '고지',
    contact: '문의',
    legalLine: `${COMPANY.name} · 대표 ${COMPANY.ceo} · 사업자등록번호 ${COMPANY.registration} · ${COMPANY.address} · ${COMPANY.email}`,
    navLabel: '페이지',
    legalNavLabel: '법적 고지',
  },
  art: { pm: 'PM', roles: ['리서처', '검토자', '작성자'], layers: ['사용자', '프로젝트', '에이전트', '실행'], approve: '승인', query: '가격표 통화', evidence: '근거 3건', pending: '승인 대기 1', alert: '밴드 이탈 → 진단' },
  board: {
    cols: ['대기', '진행', '검토'],
    cards: [
      [{ t: '경쟁사 조사', tag: 'high', who: '리서처' }, { t: '릴리스 노트', tag: 'mid', who: '작성자' }],
      [{ t: '스키마 정리', tag: 'high', who: '개발자' }],
      [{ t: '온보딩 문서', tag: 'mid', who: '검토자' }, { t: '가격표 검증', tag: 'low', who: '검토자' }],
    ],
    tags: { high: '높음', mid: '중간', low: '낮음' },
  },
  mock: {
    url: 'app.orbitcrew.ai',
    side: ['대쉬보드', '프로젝트', '에이전트', '대화', '사용량', '설정'],
    title: '대쉬보드', project: '릴리스 준비',
    focus: '집중 프로젝트',
    kpis: ['전체 업무', '검토 도달률', '평균 실행'],
    weekly: '주간 업무 처리량', status: '업무 상태 분포',
    board: 'TASK 보드', boardBy: '담당자별',
    cols: [['리서처', ['경쟁사 조사', '시장 규모']], ['작성자', ['릴리스 노트']], ['검토자', ['가격표 검증', '온보딩 문서']]],
    chat: '대화', chatWho: '프로젝트 매니저',
    msgU: '가격표 검증 어디까지 됐어?',
    msgA: '검토자가 근거 3건 확인했고, 통화 단위 1건만 되돌렸습니다.',
    input: '메시지를 입력하세요',
  },
  orbitChips: ['리서처', '검토자', '작성자'],
};

const EN: Dict = {
  nav: [
    { label: 'Product', id: 'product' },
    { label: 'Features', id: 'features' },
    { label: 'How it works', id: 'how' },
    { label: 'Crew', id: 'crew' },
    { label: 'Pricing', id: 'pricing' },
    { label: 'Get started', id: 'start' },
  ],
  openApp: 'Open app',
  beta: 'BETA',
  betaBanner: {
    t: 'In beta — top-ups are not billed',
    d: 'During the beta the checkout opens in test mode, so nothing is charged even if you enter a card. You can top up to 5,000 credits per month; leftover beta credits expire when the beta ends. Connect your own Claude API key to run on it with no cap.',
  },
  menu: 'Menu',
  langLabel: 'Language',
  eyebrow: 'YOUR GOAL. YOUR AI CREW.',
  h1a: 'BIG PLANS.',
  h1b: 'YOUR OWN',
  h1accent: 'AI TEAM.',
  heroSub: 'Give your goal to an AI manager. It brings in specialists, divides the work, and brings reviewed results back to you.',
  ctaStart: 'Build my AI team',
  ctaTour: 'See the product',
  facts: [{ n: 'You set the goal', l: 'Your manager divides the work' }, { n: 'Your crew delivers', l: 'Specialists execute and review' }, { n: 'You decide next', l: 'Review results and set direction' }],
  factsLabel: 'From goal to results',
  trust: [
    { icon: 'key', t: 'Start instantly', d: '300 free credits · pay as you go' },
    { icon: 'lock', t: 'Free with your own key', d: 'Claude API keys are encrypted server-side' },
    { icon: 'login', t: 'Google · GitHub sign-in', d: 'No separate sign-up' },
    { icon: 'code', t: 'Open source', d: 'AGPL-3.0 · public repository' },
    { icon: 'globe', t: 'English · 한국어', d: 'Light · dark theme' },
  ],
  trustLabel: 'Trust',
  product: {
    eyebrow: 'YOUR WORKDAY', h: 'AI answered. Why is the work still yours?',
    p: 'Copying answers, repeating context, checking what is missing. Let your team pick up the work inside one project.',
    notes: [
      { icon: 'chart', t: 'See progress', d: 'Know who is working on what.' },
      { icon: 'board', t: 'Delegate once', d: 'Your manager assigns the work.' },
      { icon: 'chat', t: 'Give feedback in context', d: 'Talk to the AI on the task.' },
    ],
  },
  about: { a: 'YOU SET DIRECTION.', b: 'YOUR TEAM EXECUTES.', p: 'From competitor research to a document draft, your manager connects specialists and a reviewer checks the result. You decide what comes next.', more: 'See what supports your team' },
  features: {
    eyebrow: 'CAPABILITIES',
    h: 'Why agents can be left to work alone',
    items: [
      { k: '01', t: 'Skip the task breakdown', d: 'Give your goal to a manager that finds the right roles and assigns the work.', span: 'lp-b-7', art: 'manager' },
      { k: '02', t: 'Stop repeating the background', d: 'Project and user memory help teammates carry your goals and working context forward.', span: 'lp-b-5', art: 'memory' },
      { k: '03', t: 'Pick up where you left off', d: 'Your team can find relevant past conversations and runs before continuing the work.', span: 'lp-b-4', art: 'recall' },
      { k: '04', t: 'Review results with evidence', d: 'Another AI reviews the work so you can check missing evidence and requested changes.', span: 'lp-b-4', art: 'verify' },
      { k: '05', t: 'Keep important decisions yours', d: 'Review gated actions in your approval inbox and decide whether they should proceed.', span: 'lp-b-4', art: 'gate' },
      { k: '06', t: 'Catch blocked work and unusual costs', d: 'Monitoring highlights repeated failures and changes in spending so you know where to look.', span: 'lp-b-12', art: 'band' },
    ],
  },
  how: {
    eyebrow: 'HOW IT WORKS',
    h: 'Done in four steps',
    steps: [
      { n: '01', t: 'Say the goal', d: 'Type what you want into the chat. No moving statuses by hand.', chip: 'You' },
      { n: '02', t: 'The manager builds a team', d: 'It pulls the agents it needs from the role catalog, or creates new ones and adds them to the project.', chip: 'Manager' },
      { n: '03', t: 'Agents execute', d: 'They work with memory and recall, then leave a structured completion report with evidence.', chip: 'Agents' },
      { n: '04', t: 'Review and approve', d: 'An agent other than the author filters first; only the final call is yours.', chip: 'Review → You' },
    ],
    convoLabel: 'Example conversation',
  },
  convo: {
    me: 'Me',
    user: 'Compare pricing across three competitors and draft next week’s release notes.',
    pm: 'Project manager',
    pmMsg: 'Added a researcher and a writer. Created 2 tasks — the reviewer checks the research first.',
    card1: 'Competitor pricing research', card1meta: 'Researcher · High',
    card2: 'Release notes draft', card2meta: 'Writer · Medium',
    reviewer: 'Reviewer',
    reviewMsg: 'Confirmed 3 pieces of evidence. Sent back 1 item from the spec pass: missing currency unit.',
  },
  crew: {
    eyebrow: 'THE CREW',
    h: 'The team grows with the roles you need',
    p: 'The manager pulls agents from the role catalog, and defines a role and instructions to create one when nothing fits. Every project gets a different crew.',
    items: [
      { role: 'Project manager', tag: 'Always assigned', d: 'Reads your instruction, builds the team, splits the work, reviews reports, and briefs you.', tone: 'brand' },
      { role: 'Researcher', tag: 'Catalog', d: 'Digs through web search and linked folders to produce findings with evidence.', tone: 'mint' },
      { role: 'Writer', tag: 'Catalog', d: 'Drafts documents, release notes, and emails in line with project memory.', tone: 'ink' },
      { role: 'Reviewer', tag: 'Auto-joins', d: 'Filters other agents’ work in four passes: bugs, spec, policy, evidence.', tone: 'coral' },
      { role: 'Data analyst', tag: 'Catalog', d: 'Reads tables and numbers, then proposes summaries and next actions.', tone: 'mint' },
      { role: 'Any role you need', tag: 'Auto-created', d: 'Not in the catalog? The manager defines the role and instructions and creates it.', tone: 'dash' },
    ],
  },
  compare: {
    eyebrow: 'WHY ORBITCREW',
    h: 'Not a chatbot. Not a lone agent.',
    colLabel: 'Item',
    cols: ['Plain chatbot', 'Single agent', 'orbitcrew'],
    rows: [
      { k: 'Memory', v: ['One conversation', 'Within a session', 'Four layers: user, project, agent'] },
      { k: 'Team', v: ['None', 'One does everything', 'Manager hires agents per role'] },
      { k: 'Done means', v: ['A reply arrived', 'Self-declared', 'No evidence, no completion'] },
      { k: 'Review', v: ['All on you', 'All on you', 'Another agent reviews in 4 passes first'] },
      { k: 'Cost control', v: ['Unknown', 'Check after the run', 'Auto-diagnosis when off the 14-day band'] },
      { k: 'Your role', v: ['Ask · copy-paste', 'Instruct · move statuses', 'Approve · reject · steer'] },
    ],
  },
  pricing: {
    eyebrow: 'PRICING',
    h: 'No subscription. Pay for what you use.',
    p: 'Individuals top up credits and spend them on AI usage. No ads, no personal monthly plan. Teams and companies step up only as far as they need.',
    plans: [
      {
        name: 'Personal', price: 'Pay as you go', unit: '1 credit = ₩10 · top up from ₩5,000',
        d: '300 credits land the moment you sign up. Watch the manager build a team a few times, then top up if you like it.',
        perks: ['300 free credits on sign-up', 'Free top-ups during beta — up to 5,000 credits/month', 'Per-model rates published in the app', 'Measured tokens · credit ledger', 'Unused paid credits refundable after launch'],
        cta: 'Start free', href: '/login', tag: 'Beta · free top-ups', featured: true,
      },
      {
        name: 'Team', price: 'Coming soon', unit: 'per seat · pricing TBD',
        d: 'Share a project with colleagues and split the cards the manager creates.',
        perks: ['Invite members · share projects', 'Shared credit pool', 'Permissions · audit log', 'Personal workspaces stay free'],
        cta: 'Join the waitlist', href: 'mailto:hello@orbitcrew.ai?subject=orbitcrew%20Team%20waitlist', tag: 'Phase 2',
      },
      {
        name: 'Enterprise', price: 'Self-hosted', unit: 'your servers · annual license',
        d: 'For organizations whose data can’t leave the building: install on your infrastructure and run on your own keys.',
        perks: ['Runs on your servers · no data egress', 'Your Anthropic key · usage control', 'AGPL-3.0 or commercial license', 'Onboarding support · priority response'],
        cta: 'Contact us', href: 'mailto:hello@orbitcrew.ai?subject=orbitcrew%20Enterprise%20self-hosting',
      },
    ],
    note: 'Already have a Claude API key? Connect it and orbitcrew is free — AI usage is billed by Anthropic to your account.',
    noteLink: 'How to connect a key',
    rateNote: 'Credit rate = Anthropic list price × 1.8 (VAT included). Example: one Sonnet 5 chat turn ≈ 3.5 credits.',
  },
  start: {
    eyebrow: 'GET STARTED',
    h: 'Sign in and you’re running',
    p1: 'No API key to create. Sign in and ',
    p2: '300 credits',
    p3: ' are there right away — name a project and the manager comes back with the first task. Top up when you want more, or connect your own Claude API key and use orbitcrew for free.',
    perks: [
      '300 credits on sign-up — no card required',
      'No subscription, no ads — pay for what you use',
      'Connect your own Claude API key and orbitcrew is free',
      'Open source (AGPL-3.0) — self-host if you like',
    ],
    cta: 'Start now',
    steps: [
      { n: '1', t: 'Sign in with Google or GitHub', d: 'No new account to create. Your first sign-in grants 300 credits and shows a short intro once.' },
      { n: '2', t: 'Name the project and pick a folder', d: 'That’s it — a manager is assigned and comes back with the first task.' },
      { n: '3', t: 'When you want more — top up or connect a key', d: 'Top up from ₩5,000, or connect the API key from your Anthropic account. It’s encrypted server-side, and calls on your key are never charged to credits. During the beta, top-ups go through a test checkout and are not billed (5,000 credits per month).' },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    h: 'Frequently asked questions',
    items: [
      { q: 'What is different during the beta?', a: 'orbitcrew is in beta. Pressing top-up opens the Toss Payments checkout in test mode, so nothing is billed even if you enter a card. Each user can top up to 5,000 credits per month, and leftover beta credits expire when the beta ends (we grant thank-you credits at launch). Connect your own Claude API key and runs go out on it with no cap. Usage is still measured and recorded in your ledger during the beta.' },
      { q: 'How much does it cost?', a: 'There is no subscription. Sign-up grants 300 free credits (about ₩3,000), after which credits are deducted as you use AI. One credit is ₩10 and top-ups start at ₩5,000. Connect your own Claude API key and orbitcrew is free — Anthropic bills the AI usage to you directly.' },
      { q: 'How are credits calculated?', a: 'Per-model rates are 1.8× Anthropic’s list price (VAT included) and are published in the app. One Sonnet 5 chat turn is about 3.5 credits; a manager run that drives several agents is roughly 45–180 credits. Every call is deducted from measured tokens and shows up in your ledger.' },
      { q: 'Can I get a refund on credits?', a: 'Unused paid credits are refundable (as a payment cancellation). Free sign-up credits and bonuses are not refundable or transferable. Usage draws from free and bonus credits first.' },
      { q: 'What if I have my own Claude API key?', a: 'Connect it on the account screen and every call from then on goes out on your key with no credit deduction. The key is encrypted with a server-side master secret and decrypted only at run time. Only calls from users without a key use orbitcrew’s operator key — that cost is what credits pay for.' },
      { q: 'Can I sign in with my Claude account?', a: 'No. Anthropic’s policy doesn’t allow Claude account sign-in for third-party apps. You sign in with Google or GitHub and use Claude through credits or your own API key.' },
      { q: 'Does it access files on my computer?', a: 'Only when you link a folder to a project, and only within what you allow through the browser’s folder picker. File lists and contents are passed as context for task runs.' },
      { q: 'Won’t the agents run wild?', a: 'The approval level in the chat (auto / cards only / read-only) limits the manager’s autonomy. Creating many cards or saving a global skill goes through an approval gate, and repeated failures trip a circuit breaker.' },
      { q: 'Which models does it use?', a: 'You can assign a Claude model to each agent; unassigned agents use the default. While you only have free credits, runs use Haiku and Sonnet; topping up unlocks the larger models. The usage screen shows measured tokens alongside credit deductions.' },
      { q: 'Is it open source?', a: 'Yes. The repository is public under AGPL-3.0. Self-host it or read the code.' },
    ],
  },
  cta: { a: 'ONE TASK ON YOUR MIND.', b: 'START WITH THAT.', p: 'Get 300 free credits and start your first project. No payment card required.', btn: 'Build my AI team free' },
  footer: {
    tag: 'AI Agent Command Center',
    product: 'Product',
    legal: 'Legal',
    contact: 'Contact',
    legalLine: `${COMPANY.nameEn} · CEO ${COMPANY.ceoEn} · Business reg. no. ${COMPANY.registration} · ${COMPANY.addressEn} · ${COMPANY.email}`,
    navLabel: 'Pages',
    legalNavLabel: 'Legal',
  },
  art: { pm: 'PM', roles: ['Researcher', 'Reviewer', 'Writer'], layers: ['User', 'Project', 'Agent', 'Run'], approve: 'Approve', query: 'pricing currency', evidence: '3 evidence', pending: '1 pending', alert: 'Off band → diagnose' },
  board: {
    cols: ['To do', 'Doing', 'Review'],
    cards: [
      [{ t: 'Competitor research', tag: 'high', who: 'Researcher' }, { t: 'Release notes', tag: 'mid', who: 'Writer' }],
      [{ t: 'Schema cleanup', tag: 'high', who: 'Developer' }],
      [{ t: 'Onboarding doc', tag: 'mid', who: 'Reviewer' }, { t: 'Pricing check', tag: 'low', who: 'Reviewer' }],
    ],
    tags: { high: 'High', mid: 'Medium', low: 'Low' },
  },
  mock: {
    url: 'app.orbitcrew.ai',
    side: ['Dashboard', 'Projects', 'Agents', 'Chat', 'Usage', 'Settings'],
    title: 'Dashboard', project: 'Release prep',
    focus: 'Focus project',
    kpis: ['Tasks', 'Review rate', 'Avg run'],
    weekly: 'Weekly throughput', status: 'Task status',
    board: 'Task board', boardBy: 'by assignee',
    cols: [['Researcher', ['Competitor research', 'Market size']], ['Writer', ['Release notes']], ['Reviewer', ['Pricing check', 'Onboarding doc']]],
    chat: 'Chat', chatWho: 'Project manager',
    msgU: 'How far along is the pricing check?',
    msgA: 'The reviewer confirmed 3 pieces of evidence and sent back only one currency-unit item.',
    input: 'Type a message',
  },
  orbitChips: ['Researcher', 'Reviewer', 'Writer'],
};

const DICT: Record<LandingLang, Dict> = { en: EN, ko: KO };

/**
 * 스크롤 등장·네브바 그림자·언어 토글 같은 점진적 향상. React 에서는 useEffect 로, 정적 빌드에서는
 * scripts/build-landing.mjs 가 이 함수를 문자열로 박아 넣어 같은 코드를 씁니다.
 * (그래서 import·JSX 없이 순수 DOM API 만 씁니다.)
 */
export function enhanceLanding(root: HTMLElement | null) {
  if (!root) return () => {};
  const w = window;
  const cleanups: (() => void)[] = [];

  /* 언어 — 저장값 → 기본 en. 루트 data-lang 만 바꾸면 CSS 가 트리를 전환합니다. */
  const KEY = 'orbit-landing-lang';
  const apply = (lang: string) => {
    const next = lang === 'ko' ? 'ko' : 'en';
    root.setAttribute('data-lang', next);
    document.documentElement.lang = next;
    root.querySelectorAll<HTMLElement>('[data-set-lang]').forEach((b) => {
      const on = b.getAttribute('data-set-lang') === next;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  let saved = '';
  try { saved = w.localStorage.getItem(KEY) || ''; } catch { /* 저장소 차단 환경 */ }
  apply(saved || root.getAttribute('data-lang') || 'en');
  const onLangClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-set-lang]');
    if (!btn) return;
    const lang = btn.getAttribute('data-set-lang') || 'en';
    apply(lang);
    try { w.localStorage.setItem(KEY, lang); } catch { /* 무시 */ }
  };
  root.addEventListener('click', onLangClick);
  cleanups.push(() => root.removeEventListener('click', onLangClick));

  /* 스크롤 등장 */
  const reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = Array.from(root.querySelectorAll<HTMLElement>('.lp-reveal'));
  if (!reduce && 'IntersectionObserver' in w && targets.length) {
    root.classList.add('lp-js');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    for (const el of targets) io.observe(el);
    cleanups.push(() => io.disconnect());
  }

  /* 네브바 그림자 */
  const nav = root.querySelector<HTMLElement>('.lp-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-stuck', w.scrollY > 24);
    onScroll();
    w.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => w.removeEventListener('scroll', onScroll));
  }

  return () => {
    for (const c of cleanups) c();
  };
}

export function LandingView() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => enhanceLanding(rootRef.current), []);

  return (
    <div className="lp" ref={rootRef} id="top" data-lang="en">
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />
      <div className="lp-universe" aria-hidden="true" />
      {LANDING_LANGS.map((lang) => (
        <div key={lang} className="lp-tree" data-lang={lang} lang={lang}>
          <LandingContent lang={lang} />
        </div>
      ))}
    </div>
  );
}

function LandingContent({ lang }: { lang: LandingLang }) {
  const t = DICT[lang];
  const [menuOpen, setMenuOpen] = useState(false);
  /* 앵커 id — 영어 트리가 원본, 한국어 트리는 ko- 접두 */
  const id = (s: string) => (lang === 'en' ? s : `ko-${s}`);
  const href = (s: string) => `#${id(s)}`;
  const legalLabel = (l: (typeof LEGAL_LINKS)[number]) => (lang === 'en' ? l.labelEn : l.label);

  return (
    <>
      {/* ── Nav (sticky, 히어로 위에 겹침) ────────────────────── */}
      <nav className="lp-nav">
        <a className="lp-logo" href={href('top')}>
          <span className="lp-logo-mark"><OrbitMark size={38} /></span>
          <span className="lp-logo-word">orbitcrew</span>
        </a>

        <div className="lp-nav-links">
          {t.nav.map((n) => (
            <a key={n.id} href={href(n.id)}>{n.label}</a>
          ))}
        </div>

        <LangToggle label={t.langLabel} />

        {/* oxlint-disable-next-line next/no-html-link-for-pages -- 랜딩→앱은 전체 로드가 맞습니다 */}
        <a className="lp-nav-cta" href="/login">
          {t.openApp}
          <span className="lp-beta">{t.beta}</span>
          <ArrowIcon className="lp-nav-cta-arrow" />
        </a>

        <button
          className="lp-burger"
          type="button"
          aria-label={t.menu}
          aria-controls={id('lp-mobile-menu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>

        {/* 항상 렌더하고 hidden 으로 숨깁니다 — 정적 빌드(scripts/build-landing.mjs)에서는 작은 스크립트가 hidden 을 토글합니다 */}
        <div className="lp-mobile-menu" hidden={!menuOpen} id={id('lp-mobile-menu')}>
          {t.nav.map((n) => (
            <a key={n.id} href={href(n.id)} onClick={() => setMenuOpen(false)}>{n.label}</a>
          ))}
          {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
          <a href="/login" onClick={() => setMenuOpen(false)}>{t.openApp} <span className="lp-beta">{t.beta}</span></a>
          <LangToggle label={t.langLabel} />
        </div>
      </nav>

      {/* ── Section 1 — Hero ───────────────────────────────── */}
      <section className="lp-hero" id={id('top')}>
        <div className="lp-space" aria-hidden="true">
          <div className="lp-stars lp-stars-a" />
          <div className="lp-stars lp-stars-b" />
          <div className="lp-nebula lp-nebula-a" />
          <div className="lp-nebula lp-nebula-b" />
          <div className="lp-hero-orbit"><OrbitDiagram uid={lang} /></div>
        </div>

        <div className="lp-hero-body">
          <p className="lp-eyebrow lp-eyebrow-pill">
            <span className="lp-dot" />
            {t.eyebrow}
          </p>

          <h1 className="lp-h1">
            <span className="lp-h1-line" style={{ '--i': 0 } as CSSProperties}>{t.h1a}</span>
            <span className="lp-h1-line" style={{ '--i': 1 } as CSSProperties}>
              {t.h1b} <em className="lp-accent">{t.h1accent}</em>
            </span>
          </h1>

          <p className="lp-hero-sub">{t.heroSub}</p>

          <div className="lp-hero-cta">
            {/* oxlint-disable-next-line next/no-html-link-for-pages -- 정적 랜딩 빌드에서 앱 주소로 치환됩니다 */}
            <a className="lp-btn" href="/login">
              {t.ctaStart}
              <i className="lp-btn-line" />
            </a>
            <a className="lp-btn lp-btn-ghost" href={href('how')}>
              {t.ctaTour}
            </a>
          </div>

          <ul className="lp-hero-facts" aria-label={t.factsLabel}>
            {t.facts.map((f) => (
              <li key={f.l}><strong>{f.n}</strong><span>{f.l}</span></li>
            ))}
          </ul>
        </div>

        {/* 지평선 글로우 위로 떠오르는 앱 목업 (Launch UI 히어로 구성) */}
        <div className="lp-hero-stage" id={id('product')}>
          <div className="lp-horizon" aria-hidden="true" />
          <div className="lp-hero-mock">
            <AppMock m={t.mock} />
          </div>
        </div>
      </section>

      {/* ── Trust strip ────────────────────────────────────── */}
      <section className="lp-trust" id={id('trust')} aria-label={t.trustLabel}>
        <ul className="lp-trust-list">
          {t.trust.map((x) => (
            <li key={x.t} className="lp-reveal">
              <span className="lp-trust-icon"><Icon name={x.icon} /></span>
              <span className="lp-trust-text">
                <strong>{x.t}</strong>
                <span>{x.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Section 2 — Product notes ─────────────────────── */}
      <section className="lp-product">
        <header className="lp-sec-head lp-sec-head-center lp-reveal">
          <p className="lp-eyebrow">{t.product.eyebrow}</p>
          <h2 className="lp-h3">{t.product.h}</h2>
          <p className="lp-p lp-p-center">{t.product.p}</p>
        </header>
        <ul className="lp-product-notes">
          {t.product.notes.map((n) => (
            <li key={n.t} className="lp-reveal"><Icon name={n.icon} /><span><strong>{n.t}</strong> {n.d}</span></li>
          ))}
        </ul>
      </section>

<section className="lp-model-story" id={id('models')}><div><p className="lp-eyebrow">FROM MODEL TO MOMENTUM</p><h2 className="lp-h3">{lang === 'ko' ? '새로운 AI의 능력, 내 일의 진전으로.' : 'Put powerful AI to work on your goals.'}</h2><p className="lp-p">{lang === 'ko' ? 'Fable 5.1을 팀원에게 배정하고, 조사·작성·검토를 하나의 흐름으로 연결하세요. 여러 AI의 일을 조율하는 AI 오케스트레이션을 목표 한 줄로 시작할 수 있습니다.' : 'Assign Fable 5.1 to a teammate and connect research, writing, and review. Start orchestrating your AI team with a single goal.'}</p><p className="lp-offer-note">{lang === 'ko' ? 'Fable 5.1은 본인 API 키 또는 유료 잔액이 필요합니다. 제공사 계정의 모델 접근 권한에 따라 이용이 제한될 수 있습니다.' : 'Fable 5.1 requires your API key or a paid balance, subject to provider model access.'}</p></div><div className="lp-model-flow"><span>Fable 5.1 · Claude</span><h3>{lang === 'ko' ? '“경쟁사 조사해서 제안서 초안까지.”' : '“Research the competition. Draft my proposal.”'}</h3><ol>{(lang === 'ko' ? ['매니저가 업무 분담', '리서처 → 작성자 → 검토자', '나는 결과 확인과 방향 결정'] : ['Manager divides the work', 'Researcher → Writer → Reviewer', 'You review and set direction']).map(x=><li key={x}>{x}</li>)}</ol></div></section>

      {/* ── Section 3 — About ──────────────────────────────── */}
      <section className="lp-about" id={id('about')}>
        <div className="lp-about-left lp-reveal">
          <h2 className="lp-h2">
            <span>{t.about.a}</span>
            <span className="lp-in2"><em className="lp-accent">{t.about.b}</em></span>
          </h2>
          <p className="lp-p">{t.about.p}</p>
          <a className="lp-btn lp-btn-ghost" href={href('features')}>
            {t.about.more}
            <i className="lp-btn-line" />
          </a>
        </div>

        <div className="lp-about-right lp-reveal lp-reveal-right" aria-hidden="true">
          <BoardDiagram b={t.board} />
          <div className="lp-tint" />
        </div>
      </section>

      {/* ── Section 8 — Pricing / 크레딧 · 팀 · 기업 (docs/pricing-credits.md §5) ── */}
      <section className="lp-pricing" id={id('pricing')}>
        <header className="lp-sec-head lp-sec-head-center lp-reveal">
          <p className="lp-eyebrow">{t.pricing.eyebrow}</p>
          <h2 className="lp-h3">{t.pricing.h}</h2>
          <p className="lp-p">{t.pricing.p}</p>
        </header>
        <div className="lp-beta-banner lp-reveal" role="note">
          <span className="lp-beta lp-beta-lg">{t.beta}</span>
          <div><strong>{t.betaBanner.t}</strong><p>{t.betaBanner.d}</p></div>
        </div>
        <div className="lp-free-offer lp-reveal"><div><p className="lp-eyebrow">BRING YOUR OWN KEY</p><h3>{lang === 'ko' ? '내 API 키로, orbitcrew는 무료.' : 'Your API key. Zero platform fee.'}</h3><p>{lang === 'ko' ? '본인 Anthropic API 키를 연결하면 서비스 이용료는 0원입니다. AI 사용료는 Anthropic에서 별도로 청구합니다. Claude·ChatGPT 구독에 포함되는 혜택은 아닙니다.' : 'Connect your Anthropic API key for zero orbitcrew platform fees. Anthropic bills AI usage separately. Claude and ChatGPT subscriptions do not include this API usage.'}</p></div>
          {/* oxlint-disable-next-line next/no-html-link-for-pages -- 정적 랜딩 빌드에서 앱 주소로 치환됩니다 */}
          <a className="lp-btn" href="/login">{lang === 'ko' ? '무료로 시작하기' : 'Get started free'}<span className="lp-beta">BETA</span></a></div>
        <div className="lp-plans">
          {t.pricing.plans.map((plan, i) => (
            <article key={plan.name} className={`lp-plan lp-reveal${plan.featured ? ' lp-plan-featured' : ''}`} style={{ '--d': i } as CSSProperties}>
              <div className="lp-plan-head">
                <h3>{plan.name}</h3>
                {plan.tag ? <span className="lp-plan-tag">{plan.tag}</span> : null}
              </div>
              <p className="lp-plan-price">{plan.price}</p>
              <p className="lp-plan-unit">{plan.unit}</p>
              <p className="lp-plan-d">{plan.d}</p>
              <ul className="lp-plan-perks">
                {plan.perks.map((perk) => (
                  <li key={perk}><Icon name="check" />{perk}</li>
                ))}
              </ul>
              {/* oxlint-disable-next-line next/no-html-link-for-pages -- 정적 빌드에서 /login 은 앱 주소로 치환됩니다 */}
              <a className={`lp-btn${plan.featured ? '' : ' lp-btn-ghost'}`} href={plan.href}>
                {plan.cta}
                {plan.featured ? <span className="lp-beta lp-beta-on-cta">{t.beta}</span> : null}
                {plan.featured ? <i className="lp-btn-line" /> : null}
              </a>
            </article>
          ))}
        </div>
        <p className="lp-plan-note lp-reveal">
          {t.pricing.note} <a href={href('start')}>{t.pricing.noteLink}</a>
        </p>
        <p className="lp-plan-rate lp-reveal">{t.pricing.rateNote}</p>
      </section>

      {/* ── Section 4 — Features (bento) ───────────────────── */}
      <section className="lp-features" id={id('features')}>
        <header className="lp-sec-head lp-reveal">
          <p className="lp-eyebrow">{t.features.eyebrow}</p>
          <h2 className="lp-h3">{t.features.h}</h2>
        </header>
        <div className="lp-bento">
          {t.features.items.map((f, i) => (
            <article key={f.k} className={`lp-bcard ${f.span} lp-reveal`} style={{ '--d': i } as CSSProperties}>
              <div className="lp-bcard-art" aria-hidden="true"><FeatureArt kind={f.art} a={t.art} /></div>
              <div className="lp-bcard-body">
                <span className="lp-card-k">{f.k}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Section 5 — How it works ───────────────────────── */}
      <section className="lp-how" id={id('how')}>
        <header className="lp-sec-head lp-reveal">
          <p className="lp-eyebrow lp-eyebrow-dim">{t.how.eyebrow}</p>
          <h2 className="lp-h3 lp-h3-inv">{t.how.h}</h2>
        </header>
        <ol className="lp-steps">
          {t.how.steps.map((s, i) => (
            <li key={s.n} className="lp-reveal" style={{ '--d': i } as CSSProperties}>
              <span className="lp-step-track" aria-hidden="true"><i /></span>
              <span className="lp-step-n">{s.n}</span>
              <span className="lp-step-chip">{s.chip}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>

        <div className="lp-convo lp-reveal" aria-label={t.how.convoLabel}>
          <div className="lp-msg lp-msg-user">
            <span className="lp-msg-who">{t.convo.me}</span>
            <p>{t.convo.user}</p>
          </div>
          <div className="lp-msg lp-msg-agent">
            <span className="lp-msg-who"><OrbitMark size={14} /> {t.convo.pm}</span>
            <p>{t.convo.pmMsg}</p>
            <div className="lp-msg-cards">
              <span><b>{t.convo.card1}</b> {t.convo.card1meta}</span>
              <span><b>{t.convo.card2}</b> {t.convo.card2meta}</span>
            </div>
          </div>
          <div className="lp-msg lp-msg-agent lp-msg-report">
            <span className="lp-msg-who"><OrbitMark size={14} /> {t.convo.reviewer}</span>
            <p>{t.convo.reviewMsg}</p>
          </div>
        </div>
      </section>

      {/* ── Section 6 — Crew ───────────────────────────────── */}
      <section className="lp-crew" id={id('crew')}>
        <header className="lp-sec-head lp-reveal">
          <p className="lp-eyebrow">{t.crew.eyebrow}</p>
          <h2 className="lp-h3">{t.crew.h}</h2>
          <p className="lp-p">{t.crew.p}</p>
        </header>
        <div className="lp-crew-grid">
          {t.crew.items.map((c, i) => (
            <article key={c.role} className={`lp-crew-card lp-crew-${c.tone} lp-reveal`} style={{ '--d': i } as CSSProperties}>
              <span className="lp-crew-avatar" aria-hidden="true"><CrewGlyph tone={c.tone} /></span>
              <span className="lp-crew-tag">{c.tag}</span>
              <h3>{c.role}</h3>
              <p>{c.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Section 9 — Start / 가입 즉시 300 크레딧 ────────── */}
      <section className="lp-start" id={id('start')}>
        <div className="lp-start-left lp-reveal">
          <p className="lp-eyebrow">{t.start.eyebrow}</p>
          <h2 className="lp-h3">{t.start.h}</h2>
          <p className="lp-p">
            {t.start.p1}<strong>{t.start.p2}</strong>{t.start.p3}
          </p>
          <ul className="lp-start-perks">
            {t.start.perks.map((p) => (
              <li key={p}><Icon name="check" />{p}</li>
            ))}
          </ul>
          {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
          <a className="lp-btn" href="/login">
            {t.start.cta}
            <i className="lp-btn-line" />
          </a>
        </div>
        <ol className="lp-start-steps">
          {t.start.steps.map((s, i) => (
            <li key={s.n} className="lp-reveal" style={{ '--d': i } as CSSProperties}>
              <span className="lp-start-n">{s.n}</span>
              <div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Section 10 — FAQ ───────────────────────────────── */}
      <section className="lp-faq" id={id('faq')}>
        <header className="lp-sec-head lp-reveal">
          <p className="lp-eyebrow">{t.faq.eyebrow}</p>
          <h2 className="lp-h3">{t.faq.h}</h2>
        </header>
        <div className="lp-faq-list">
          {t.faq.items.map((f, i) => (
            <details key={f.q} className="lp-faq-item lp-reveal" style={{ '--d': i } as CSSProperties}>
              <summary>
                <span>{f.q}</span>
                <span className="lp-faq-plus" aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Section 11 — CTA ───────────────────────────────── */}
      <section className="lp-cta" id={id('cta')}>
        <div className="lp-cta-bg" aria-hidden="true">
          <div className="lp-stars lp-stars-a" />
          <div className="lp-cta-ring" />
          <div className="lp-cta-ring" />
          <div className="lp-cta-ring" />
          <div className="lp-horizon lp-horizon-cta" />
        </div>
        <h2 className="lp-h2 lp-h2-center lp-reveal">
          <span>{t.cta.a}</span>
          <span><em className="lp-accent">{t.cta.b}</em></span>
        </h2>
        <p className="lp-p lp-p-center lp-reveal">{t.cta.p}</p>
        <div className="lp-reveal">
          {/* oxlint-disable-next-line next/no-html-link-for-pages -- 위와 같은 이유 */}
          <a className="lp-btn" href="/login">
            {t.cta.btn}
            <span className="lp-beta lp-beta-on-cta">{t.beta}</span>
            <i className="lp-btn-line" />
          </a>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <span className="lp-logo-mark lp-footer-mark"><OrbitMark size={30} /></span>
            <span className="lp-logo-word lp-footer-word">orbitcrew</span>
            <span className="lp-footer-tag">{t.footer.tag}</span>
          </div>
          <nav className="lp-footer-col" aria-label={t.footer.navLabel}>
            <p>{t.footer.product}</p>
            {t.nav.map((n) => (
              <a key={n.id} href={href(n.id)}>{n.label}</a>
            ))}
          </nav>
          <nav className="lp-footer-col" aria-label={t.footer.legalNavLabel}>
            <p>{t.footer.legal}</p>
            {LEGAL_LINKS.map((link) => (
              // oxlint-disable-next-line next/no-html-link-for-pages -- 정적 빌드에서는 절대 주소로 치환됩니다 (scripts/build-landing.mjs)
              <a href={link.href} key={link.href}>{legalLabel(link)}</a>
            ))}
            <a href={`mailto:${COMPANY.email}`}>{t.footer.contact}</a>
          </nav>
        </div>
        <p className="lp-footer-legal">{t.footer.legalLine}</p>
      </footer>
    </>
  );
}

/** 언어 토글 — EN | 한. 실제 전환은 enhanceLanding() 의 클릭 위임이 처리합니다(정적 빌드 공용). */
function LangToggle({ label }: { label: string }) {
  return (
    <fieldset className="lp-lang">
      <legend className="lp-sr">{label}</legend>
      <button type="button" className="lp-lang-btn" data-set-lang="en" aria-pressed="false">EN</button>
      <button type="button" className="lp-lang-btn" data-set-lang="ko" aria-pressed="false">한</button>
    </fieldset>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* 아이콘·일러스트                                               */
/* ─────────────────────────────────────────────────────────── */

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 3.5L13 8L8.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Icon({ name }: { name: IconName }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const d: Record<IconName, ReactNode> = {
    key: <><circle cx="8" cy="15" r="4" {...p} /><path d="M11 12l8-8M15 8l2.5 2.5M18 5l2 2" {...p} /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" {...p} /><path d="M8 11V8a4 4 0 018 0v3" {...p} /></>,
    login: <><path d="M10 17l5-5-5-5M15 12H3" {...p} /><path d="M13 4h6v16h-6" {...p} /></>,
    code: <><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" {...p} /></>,
    globe: <><circle cx="12" cy="12" r="9" {...p} /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" {...p} /></>,
    chart: <><path d="M4 19V5M4 19h16" {...p} /><path d="M8 15l3-4 3 2 4-6" {...p} /></>,
    board: <><rect x="3" y="4" width="5" height="16" rx="1.2" {...p} /><rect x="10" y="4" width="5" height="10" rx="1.2" {...p} /><rect x="17" y="4" width="4" height="13" rx="1.2" {...p} /></>,
    chat: <><path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V6z" {...p} /></>,
    check: <><path d="M5 12.5l4.5 4.5L19 7.5" {...p} /></>,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="lp-ic">
      {d[name]}
    </svg>
  );
}

/** 히어로 비주얼 — 매니저 코어를 도는 에이전트 궤도. 영상 대신 쓰는 SVG. (uid: 두 언어 트리의 gradient id 충돌 방지) */
function OrbitDiagram({ uid }: { uid: string }) {
  // Each satellite and its fading wake share one elliptical path. No visible orbit rails.
  const flights = [
    { cx: 310, cy: 310, rx: 128, ry: 66, tilt: -18, duration: 22, phase: 0, color: '#9edcff' },
    { cx: 310, cy: 310, rx: 168, ry: 84, tilt: 24, duration: 29, phase: 72, color: '#ffd76a' },
    { cx: 310, cy: 310, rx: 208, ry: 104, tilt: -42, duration: 37, phase: 144, color: '#77f4da' },
    { cx: 310, cy: 310, rx: 248, ry: 124, tilt: 42, duration: 46, phase: 216, color: '#c49aff' },
    { cx: 310, cy: 310, rx: 288, ry: 144, tilt: -8, duration: 58, phase: 288, color: '#ff91af' },
  ];
  return (
    <svg className="lp-orbit" viewBox="0 0 620 620" role="presentation">
      <defs>
        {flights.map((f, i) => (
          <path key={i} id={`lp-flight-${uid}-${i}`} pathLength="360"
            d={`M ${f.cx + f.rx} ${f.cy} a ${f.rx} ${f.ry} 0 1 1 ${-2 * f.rx} 0 a ${f.rx} ${f.ry} 0 1 1 ${2 * f.rx} 0`} />
        ))}
      </defs>
      <g className="lp-central-star" aria-hidden="true">
        <foreignObject x="254" y="254" width="112" height="112" overflow="visible">
          <div className="lp-star-sphere"><div className="lp-star-texture" /><div className="lp-star-shading" /></div>
        </foreignObject>
      </g>
      {flights.map((f, i) => (
        <g key={f.color} transform={`rotate(${f.tilt} ${f.cx} ${f.cy})`}
          style={{ color: f.color, '--flight-duration': `${f.duration}s`, '--flight-delay': `-${f.duration * f.phase / 360}s` } as CSSProperties}>
          {/* Use the same SVG motion clock and path for the head and every particle.
              Negative start times place the full trailing wake on screen immediately. */}
          {Array.from({ length: 64 }, (_, j) => {
            // Stable pseudo-random values keep SSR and hydration identical.
            const noise = (seed: number) => {
              const n = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
              return n - Math.floor(n);
            };
            const age = (j + 0.4 + noise(j + 2) * 0.6) / 64;
            const phase = ((f.phase + 40.75) / 360 - age * 0.2 + 1) % 1;
            const spread = 0.6 + Math.pow(age, 0.8) * 10;
            const drift = 0.3 + age * 4;
            return (
              <g key={j} className="lp-satellite-particle" opacity={0.85 * Math.pow(1 - age, 1.7)}>
                <g>
                  <animate attributeName="opacity" values=".65;1;.65;.2;.65" keyTimes="0;.25;.5;.75;1" dur={`${f.duration}s`} begin={`-${f.duration * phase}s`} repeatCount="indefinite" />
                  <g className="lp-dust-cloud" style={{
                    '--dust-x': `${(noise(j + 41) - 0.5) * drift * 2}px`,
                    '--dust-y': `${drift}px`,
                    '--dust-duration': `${3.5 + noise(j + 17) * 5}s`,
                    '--dust-delay': `-${noise(j + 29) * 9}s`,
                  } as CSSProperties}>
                    {Array.from({ length: 9 }, (_, k) => {
                      const seed = j * 19 + k * 7 + 1;
                      const angle = noise(seed) * Math.PI * 2;
                      const distance = Math.pow(noise(seed + 3), 0.65) * spread;
                      return <circle key={k}
                        cx={Math.cos(angle) * distance * 0.85}
                        cy={Math.sin(angle) * distance + Math.sin(age * 16 + i) * age * 2}
                        r={(0.17 + noise(seed + 5) * 0.55) * (1 - age * 0.45)}
                        fill={k === 0 ? '#effaff' : k === 3 ? '#b7a7ff' : 'currentColor'}
                        opacity={0.25 + noise(seed + 9) * 0.75} />;
                    })}
                  </g>
                </g>
                <animateMotion dur={`${f.duration}s`} begin={`-${f.duration * phase}s`} repeatCount="indefinite" calcMode="paced" rotate="auto">
                  <mpath href={`#lp-flight-${uid}-${i}`} />
                </animateMotion>
              </g>
            );
          })}
          <g className="lp-satellite">
            <g className="lp-satellite-depth">
              <circle r="8" fill="currentColor" opacity=".1" />
              <circle r="3" fill="currentColor" className="lp-signal-head" />
              <circle r="1.3" fill="white" />
              <animateTransform attributeName="transform" type="scale" values="1;1.45;1;0.55;1" keyTimes="0;.25;.5;.75;1" dur={`${f.duration}s`} begin={`-${f.duration * (f.phase + 40.75) / 360}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values=".7;1;.7;.25;.7" keyTimes="0;.25;.5;.75;1" dur={`${f.duration}s`} begin={`-${f.duration * (f.phase + 40.75) / 360}s`} repeatCount="indefinite" />
            </g>
            <animateMotion dur={`${f.duration}s`} begin={`-${f.duration * (f.phase + 40.75) / 360}s`} repeatCount="indefinite" calcMode="paced">
              <mpath href={`#lp-flight-${uid}-${i}`} />
            </animateMotion>
          </g>
          <circle className="lp-satellite-still" cx={f.cx + f.rx} cy={f.cy} r="3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/** 어바웃 비주얼 — 카드가 검토 열로 넘어가는 보드. */
function BoardDiagram({ b }: { b: Dict['board'] }) {
  return (
    <div className="lp-board">
      {b.cols.map((h, ci) => (
        <div key={h} className="lp-board-col">
          <p className="lp-board-h">{h}<span>{b.cards[ci].length}</span></p>
          {b.cards[ci].map((card) => (
            <div key={card.t} className="lp-board-card">
              <span className="lp-board-t">{card.t}</span>
              <span className="lp-board-meta">
                <span className={`lp-board-tag lp-tag-${card.tag}`}>{b.tags[card.tag]}</span>
                <span className="lp-board-who">{card.who}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 제품 미리보기 — 앱 화면을 CSS 로 그린 목업(브라우저 프레임 + 사이드바 + 대쉬보드 + 보드 + 대화). */
function AppMock({ m }: { m: Dict['mock'] }) {
  const bars = [42, 58, 50, 72, 64, 80, 68];
  return (
    <div className="lp-mock">
      <div className="lp-mock-bar" aria-hidden="true">
        <span /><span /><span />
        <i>{m.url}</i>
      </div>
      <div className="lp-mock-body">
        <aside className="lp-mock-side" aria-hidden="true">
          <div className="lp-mock-side-logo"><OrbitMark size={16} /><b>orbitcrew</b></div>
          {m.side.map((s, i) => (
            <span key={s} className={i === 0 ? 'is-on' : undefined}><i />{s}</span>
          ))}
        </aside>
        <div className="lp-mock-main">
          <div className="lp-mock-head">
            <span className="lp-mock-title">{m.title} <em>· {m.project}</em></span>
            <span className="lp-mock-user" />
          </div>
          <div className="lp-mock-grid">
            <div className="lp-mock-card lp-mock-focus">
              <p>{m.focus}</p>
              <h4>{m.project}</h4>
              <div className="lp-mock-kpis">
                <span><b>12</b>{m.kpis[0]}</span>
                <span><b>83%</b>{m.kpis[1]}</span>
                <span><b>2.4m</b>{m.kpis[2]}</span>
              </div>
            </div>
            <div className="lp-mock-card">
              <p>{m.weekly}</p>
              <div className="lp-mock-bars">
                {bars.map((h, i) => (
                  <span key={i}><i style={{ height: `${h}%` }} /><i style={{ height: `${Math.max(18, h - 22)}%` }} /></span>
                ))}
              </div>
            </div>
            <div className="lp-mock-card lp-mock-donut-card">
              <p>{m.status}</p>
              <div className="lp-mock-donut"><b>12</b></div>
            </div>
            <div className="lp-mock-card lp-mock-board">
              <p>{m.board} <em>{m.boardBy}</em></p>
              <div className="lp-mock-cols">
                {m.cols.map(([h, cards]) => (
                  <div key={h}>
                    <span className="lp-mock-colh">{h}</span>
                    {cards.map((c) => (
                      <span key={c} className="lp-mock-task"><i />{c}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-mock-card lp-mock-chat">
              <p>{m.chat} <em>{m.chatWho}</em></p>
              <div className="lp-mock-msg lp-mock-msg-u">{m.msgU}</div>
              <div className="lp-mock-msg">{m.msgA}</div>
              <div className="lp-mock-input"><span>{m.input}</span><i /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 기능 카드 일러스트 — 토큰 색만 쓰는 작은 SVG. */
function FeatureArt({ kind, a }: { kind: ArtKind; a: Dict['art'] }) {
  switch (kind) {
    case 'manager':
      return (
        <svg viewBox="0 0 280 140" className="lp-art">
          <circle cx="60" cy="70" r="24" className="lp-art-core" />
          <text x="60" y="74" className="lp-art-core-t">{a.pm}</text>
          {[24, 70, 116].map((y, i) => (
            <g key={y}>
              <path d={`M84 70 C 130 70, 130 ${y}, 176 ${y}`} className="lp-art-link" style={{ animationDelay: `${i * 0.4}s` }} />
              <rect x="176" y={y - 13} width="96" height="26" rx="13" className="lp-art-pill" />
              <circle cx="192" cy={y} r="6" className={i === 1 ? 'lp-art-dot-mint' : i === 2 ? 'lp-art-dot-brand' : 'lp-art-dot-ink'} />
              <text x="206" y={y + 4} className="lp-art-pill-t">{a.roles[i]}</text>
            </g>
          ))}
        </svg>
      );
    case 'memory':
      return (
        <svg viewBox="0 0 280 140" className="lp-art">
          {a.layers.map((t, i) => (
            <g key={t}>
              <rect x={40 + i * 10} y={18 + i * 26} width={200 - i * 20} height="20" rx="10" className="lp-art-layer" style={{ opacity: 1 - i * 0.18 }} />
              <text x={54 + i * 10} y={32 + i * 26} className="lp-art-layer-t">{t}</text>
            </g>
          ))}
          <rect x="186" y="18" width="54" height="20" rx="10" className="lp-art-badge" />
          <text x="213" y="32" className="lp-art-badge-t">{a.approve}</text>
        </svg>
      );
    case 'recall':
      return (
        <svg viewBox="0 0 280 140" className="lp-art">
          <rect x="30" y="30" width="220" height="30" rx="15" className="lp-art-search" />
          <circle cx="50" cy="45" r="6" className="lp-art-search-ic" />
          <path d="M54 49l5 5" className="lp-art-search-ic" />
          <text x="66" y="49" className="lp-art-search-t">{a.query}</text>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="30" y={74 + i * 20} width={220 - i * 40} height="12" rx="6" className="lp-art-hit" style={{ opacity: 0.9 - i * 0.28 }} />
              <rect x="30" y={74 + i * 20} width={34} height="12" rx="6" className="lp-art-hit-hl" />
            </g>
          ))}
        </svg>
      );
    case 'verify':
      return (
        <svg viewBox="0 0 280 140" className="lp-art">
          <rect x="40" y="22" width="200" height="96" rx="14" className="lp-art-doc" />
          {[44, 62].map((y) => (
            <rect key={y} x="58" y={y} width="120" height="8" rx="4" className="lp-art-line" />
          ))}
          <rect x="58" y="86" width="96" height="18" rx="9" className="lp-art-badge" />
          <text x="106" y="99" className="lp-art-badge-t">{a.evidence}</text>
          <circle cx="212" cy="46" r="16" className="lp-art-check" />
          <path d="M204 46l6 6 10-11" className="lp-art-check-m" />
        </svg>
      );
    case 'gate':
      return (
        <svg viewBox="0 0 280 140" className="lp-art">
          <path d="M20 70 H118" className="lp-art-rail" />
          <path d="M162 70 H260" className="lp-art-rail" />
          <rect x="118" y="34" width="44" height="72" rx="12" className="lp-art-gate" />
          <rect x="132" y="48" width="16" height="44" rx="8" className="lp-art-gate-slot" />
          <circle cx="60" cy="70" r="9" className="lp-art-dot-ink lp-art-mover" />
          <circle cx="222" cy="70" r="9" className="lp-art-dot-mint" />
          <rect x="176" y="18" width="84" height="20" rx="10" className="lp-art-pill" />
          <text x="218" y="32" className="lp-art-pill-t lp-art-center">{a.pending}</text>
        </svg>
      );
    case 'band':
      return (
        <svg viewBox="0 0 560 140" className="lp-art lp-art-wide" preserveAspectRatio="none">
          <path d="M0 52 C 90 40, 180 66, 280 54 S 470 34, 560 48 V 96 C 470 104, 380 84, 280 92 S 90 112, 0 98 Z" className="lp-art-band" />
          <path d="M0 75 C 90 72, 180 84, 280 72 S 470 66, 560 72" className="lp-art-baseline" />
          <path d="M0 80 C 70 76, 120 90, 180 78 S 300 60, 360 70 S 470 30, 520 26 S 545 24, 560 22" className="lp-art-series" />
          <circle cx="520" cy="26" r="6" className="lp-art-alert" />
          <rect x="400" y="6" width="136" height="20" rx="10" className="lp-art-badge lp-art-badge-alert" />
          <text x="468" y="20" className="lp-art-badge-t">{a.alert}</text>
        </svg>
      );
    default:
      return null;
  }
}

/** 크루 카드 아바타 — 단색 기하 글리프. */
function CrewGlyph({ tone }: { tone: Tone }) {
  if (tone === 'dash') {
    return (
      <svg viewBox="0 0 40 40" width="40" height="40">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 4" />
        <path d="M20 13v14M13 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" width="40" height="40">
      <circle cx="20" cy="20" r="18" fill="currentColor" opacity=".16" />
      <circle cx="20" cy="16" r="6" fill="currentColor" />
      <path d="M9 32c1.8-6 5.6-9 11-9s9.2 3 11 9" fill="currentColor" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* 스타일                                                        */
/* ─────────────────────────────────────────────────────────── */

const LP_CSS = `
.lp{
  /* 우주 테마 — 시스템 테마와 무관하게 항상 다크. 팔레트는 Launch UI(ultraviolet) 토큰 + 브랜드 노랑. */
  color-scheme:dark;
  --lp-bg:#030711;
  --lp-bg-2:#0e0e13;
  --lp-bg-3:#15151c;
  --lp-ink:#fafafa;
  --lp-text:#e4e4e7;
  --lp-muted:#b6c2d6;
  --lp-soft:#8d9db6;
  --lp-line:#ffffff1a;
  --lp-line-soft:#ffffff0d;
  --lp-line-strong:#ffffff33;
  --lp-card:#fafafa05;
  --lp-card-2:#fafafa0a;
  --lp-card-solid:#0c182c66;
  --lp-brand:#ffd02f;
  --lp-brand-deep:#fcb900;
  --lp-brand-soft:#ffd02f26;
  --lp-on-brand:#1c1c1e;
  --lp-violet:#a78bfa;
  --lp-indigo:#4f46e5;
  --lp-indigo-soft:#4f46e526;
  --lp-teal:#5eead4;
  --lp-coral:#fda4af;
  --lp-coral-soft:#fda4af26;
  --lp-success:#6ee7b7;
  --lp-cta:#fafafa;
  --lp-on-cta:#18181b;
  --lp-shadow:#00000080;
  --lp-glow:0 0 64px #4f46e5,0 0 8px #a78bfacc;
  --lp-indent:min(160px,18vw);
  --lp-gutter:clamp(20px,7vw,96px);
  --lp-r-full:9999px;
  --lp-r-card:16px;
  --lp-r-lg:20px;
  --lp-r-feature:24px;
  --lp-ease:cubic-bezier(.2,.7,.2,1);
  --lp-nav-h:76px;
  font-family:var(--font-app,var(--font-app-sans),'Figtree','Pretendard','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  background:transparent;
  color:var(--lp-text);
  -webkit-font-smoothing:antialiased;
  scroll-behavior:smooth;
  overflow-x:clip;
  position:relative;
}
.lp *{ box-sizing:border-box; }
/* Isolate heading colors from the application light-theme defaults. */
.lp :is(h1,h2,h3,h4,h5,h6){color:var(--lp-ink);}

/* ── 언어 트리 전환 (루트 data-lang 이 고르는 쪽만 보임) ── */
.lp-tree{ display:none; }
.lp[data-lang="en"] > .lp-tree[data-lang="en"],.lp[data-lang="ko"] > .lp-tree[data-lang="ko"]{ display:block; }
.lp-lang{ margin:0 0 0 auto; min-width:0; display:inline-flex; align-items:center; padding:3px; border:1px solid var(--lp-line); border-radius:var(--lp-r-full); background:#ffffff0a; backdrop-filter:blur(8px); }
.lp .lp-lang-btn{ appearance:none; border:0; background:transparent; color:var(--lp-muted); font:inherit; font-size:12px; font-weight:600; letter-spacing:.04em; line-height:1; padding:7px 11px; border-radius:var(--lp-r-full); cursor:pointer; transition:background .2s ease,color .2s ease; }
.lp .lp-lang-btn:hover{ color:var(--lp-ink); }
.lp .lp-lang-btn.is-on{ background:var(--lp-ink); color:var(--lp-on-cta); }
.lp-mobile-menu .lp-lang{ margin-left:0; align-self:flex-start; }
.lp a{ color:inherit; text-decoration:none; }
.lp :is(section){ scroll-margin-top:72px; position:relative; }
.lp-sr{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.lp-ic{ flex:none; }
.lp ::selection{ background:var(--lp-indigo); color:#fff; }

/* ── 우주 배경: 별 · 성운 · 지평선 ── */
.lp-space{ position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
.lp-stars{ position:absolute; inset:-10%; background-repeat:repeat; }
.lp-stars-a{ opacity:.9; background-size:520px 520px;
  background-image:
    radial-gradient(1px 1px at 12% 18%,#fff 60%,transparent 100%),
    radial-gradient(1.4px 1.4px at 48% 8%,#fff 60%,transparent 100%),
    radial-gradient(1px 1px at 82% 26%,#e0e7ff 60%,transparent 100%),
    radial-gradient(1.2px 1.2px at 26% 54%,#fff 60%,transparent 100%),
    radial-gradient(1px 1px at 64% 44%,#fff 60%,transparent 100%),
    radial-gradient(1.8px 1.8px at 90% 66%,#fef3c7 60%,transparent 100%),
    radial-gradient(1px 1px at 8% 80%,#fff 60%,transparent 100%),
    radial-gradient(1.3px 1.3px at 40% 88%,#e0e7ff 60%,transparent 100%),
    radial-gradient(1px 1px at 72% 92%,#fff 60%,transparent 100%),
    radial-gradient(1px 1px at 56% 70%,#fff 60%,transparent 100%); }
.lp-stars-b{ opacity:.55; background-size:790px 790px; animation:lp-twinkle 6s ease-in-out infinite;
  background-image:
    radial-gradient(1px 1px at 22% 12%,#fff 60%,transparent 100%),
    radial-gradient(2px 2px at 68% 20%,#c7d2fe 60%,transparent 100%),
    radial-gradient(1px 1px at 36% 38%,#fff 60%,transparent 100%),
    radial-gradient(1.5px 1.5px at 86% 48%,#fff 60%,transparent 100%),
    radial-gradient(1px 1px at 14% 62%,#fff 60%,transparent 100%),
    radial-gradient(2.2px 2.2px at 52% 58%,#ffd02f 60%,transparent 100%),
    radial-gradient(1px 1px at 78% 82%,#fff 60%,transparent 100%),
    radial-gradient(1.2px 1.2px at 30% 92%,#fff 60%,transparent 100%); }
.lp-nebula{ position:absolute; border-radius:50%; filter:blur(80px); pointer-events:none; }
.lp-nebula-a{ width:70vw; height:44vw; max-width:1100px; max-height:700px; left:50%; top:-14vw; transform:translateX(-50%);
  background:radial-gradient(closest-side,#4f46e566 0%,#312e8144 45%,transparent 100%); animation:lp-drift 22s ease-in-out infinite alternate; }
.lp-nebula-b{ width:34vw; height:34vw; max-width:520px; max-height:520px; right:-8vw; top:26%;
  background:radial-gradient(closest-side,#a78bfa33 0%,transparent 100%); animation:lp-drift 18s ease-in-out infinite alternate-reverse; }
.lp-hero-orbit{ position:absolute; left:50%; top:calc(var(--lp-nav-h) + 20px); width:min(1100px,120vw); transform:translateX(-50%); opacity:.28;
  -webkit-mask-image:radial-gradient(60% 60% at 50% 45%,#000 30%,transparent 100%); mask-image:radial-gradient(60% 60% at 50% 45%,#000 30%,transparent 100%); }
.lp-horizon{ position:absolute; left:50%; bottom:0; width:min(1400px,140vw); height:min(52vw,520px); transform:translateX(-50%); pointer-events:none;
  background:radial-gradient(50% 58% at 50% 100%,#6d5df0 0%,#4f46e5cc 22%,#4f46e566 44%,#31166b22 62%,transparent 76%); filter:blur(6px); }

/* ── 스크롤 등장 (JS 가 .lp-js 를 붙일 때만 숨김) ── */
.lp.lp-js .lp-reveal{ opacity:0; transform:translateY(22px); transition:opacity .7s var(--lp-ease),transform .8s var(--lp-ease); transition-delay:calc(var(--d,0) * 70ms); }
.lp.lp-js .lp-reveal-right{ transform:translateX(36px); }
.lp.lp-js .lp-reveal.is-in{ opacity:1; transform:none; }

/* 공통 타이포 */
.lp-eyebrow{ margin:0 0 18px; font-size:11px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:var(--lp-violet); }
.lp-eyebrow-dim{ color:var(--lp-brand); }
.lp-eyebrow-pill{ display:inline-flex; align-self:center; align-items:center; gap:8px; padding:6px 14px 6px 10px; border:1px solid var(--lp-line); border-radius:var(--lp-r-full);
  background:#09090b99; backdrop-filter:blur(8px); color:var(--lp-text); letter-spacing:.14em; box-shadow:inset 0 1px 0 #ffffff14; }
.lp-dot{ width:8px; height:8px; border-radius:50%; background:var(--lp-brand); box-shadow:0 0 0 3px var(--lp-brand-soft),0 0 12px var(--lp-brand); animation:lp-blink 2.4s ease-in-out infinite; }
.lp-h1,.lp-h2{ margin:0; font-weight:600; letter-spacing:-.035em; line-height:1.02; color:var(--lp-ink); display:flex; flex-direction:column; }
.lp-h1{ font-size:clamp(40px,7vw,92px); align-items:center; text-align:center; }
.lp-h1-line{ animation:lp-rise .9s var(--lp-ease) both; animation-delay:calc(var(--i,0) * 120ms + 80ms);
  background:linear-gradient(180deg,#ffffff 0%,#fafafa 55%,#fafafa80 100%); -webkit-background-clip:text; background-clip:text; color:transparent; padding-bottom:.06em; }
.lp-h2{ font-size:clamp(34px,5.6vw,60px); letter-spacing:-.03em; }
.lp-in2{ padding-left:var(--lp-indent); }
.lp-accent{ font-style:normal; background:linear-gradient(180deg,#fff2b3 0%,var(--lp-brand) 60%,var(--lp-brand-deep) 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 0 22px #ffd02f55); }
.lp-h3{ margin:0; font-size:clamp(26px,3.2vw,38px); font-weight:600; letter-spacing:-.02em; line-height:1.18; color:var(--lp-ink); }
.lp-h3-inv{ color:var(--lp-ink); }
.lp-p{ max-width:540px; font-size:clamp(14px,1.6vw,17px); line-height:1.75; color:var(--lp-muted); }
.lp-p strong{ font-weight:600; color:var(--lp-ink); }
.lp-sec-head{ max-width:640px; margin-bottom:clamp(36px,5vw,64px); }
.lp-sec-head .lp-p{ margin:16px 0 0; }
.lp-sec-head-center{ margin-left:auto; margin-right:auto; text-align:center; }
.lp-sec-head-center .lp-p{ margin-left:auto; margin-right:auto; }

/* 버튼 — 흰 알약(primary) / 유리 알약(secondary) */
.lp .lp-btn{
  display:inline-flex; align-items:center; gap:12px;
  background:var(--lp-cta); border:1px solid transparent; color:var(--lp-on-cta);
  font-weight:600; letter-spacing:0; font-size:15px; line-height:1.3;
  padding:14px 28px; border-radius:var(--lp-r-full); cursor:pointer;
  box-shadow:0 0 0 1px #ffffff1a,0 8px 24px -10px #ffffff66;
  transition:background .2s ease,transform .2s ease,box-shadow .25s ease;
}
.lp .lp-btn:hover{ background:#fff; transform:translateY(-1px); box-shadow:0 0 0 1px #ffffff33,0 0 32px -4px #a78bfa99,0 12px 28px -12px #ffffff80; }
.lp-btn-line{ width:18px; height:1px; background:currentColor; display:block; opacity:.7; transition:width .2s ease; }
.lp .lp-btn:hover .lp-btn-line{ width:26px; }
.lp .lp-btn-ghost{ background:#fafafa14; border-color:var(--lp-line); color:var(--lp-ink); box-shadow:inset 0 1px 0 #ffffff14; backdrop-filter:blur(8px); }
.lp .lp-btn-ghost:hover{ background:#fafafa22; border-color:var(--lp-line-strong); box-shadow:inset 0 1px 0 #ffffff1f; }

/* ── 네브바 ── */
.lp-nav{ position:sticky; top:0; z-index:20; height:var(--lp-nav-h); margin-bottom:calc(-1 * var(--lp-nav-h)); display:flex; align-items:center; gap:clamp(20px,5vw,56px);
  padding:0 clamp(20px,4vw,48px); transition:background .3s ease,box-shadow .3s ease; }
.lp-nav.is-stuck{ background:#08122380; backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); box-shadow:0 1px 0 var(--lp-line); }
.lp-logo{ display:flex; align-items:center; gap:12px; }
.lp-logo-mark{ width:38px; height:38px; display:grid; place-items:center; color:var(--lp-ink); filter:drop-shadow(0 0 10px #ffd02f66); }
.lp-logo-word{ font-size:clamp(22px,5vw,28px); font-weight:500; color:var(--lp-ink); letter-spacing:-.5px; }
.lp-nav-links{ display:flex; gap:clamp(18px,3vw,34px); }
.lp-nav-links a{ position:relative; font-weight:500; font-size:clamp(12px,2.4vw,14.5px); letter-spacing:.02em; color:var(--lp-muted); white-space:nowrap; padding:4px 0; transition:color .2s ease; }
.lp-nav-links a::after{ content:''; position:absolute; left:0; right:0; bottom:-2px; height:1.5px; border-radius:2px; background:var(--lp-violet); transform:scaleX(0); transform-origin:left; transition:transform .25s var(--lp-ease); }
.lp-nav-links a:hover{ color:var(--lp-ink); }
.lp-nav-links a:hover::after{ transform:scaleX(1); }
.lp .lp-nav-cta{ margin-left:14px; display:inline-flex; align-items:center; gap:8px; background:var(--lp-brand); border:0;
  color:var(--lp-on-brand); font-size:14px; font-weight:600; padding:11px 22px; cursor:pointer;
  border-radius:var(--lp-r-full); box-shadow:0 0 24px -6px #ffd02f99; transition:background .2s ease,box-shadow .2s ease; }
.lp .lp-nav-cta:hover{ background:var(--lp-brand-deep); box-shadow:0 0 32px -4px #ffd02fcc; }
.lp-nav-cta-arrow{ transition:transform .2s ease; }
/* 베타 배지 — 앱으로 들어가는 CTA 마다. 노랑 버튼 위에서는 남색 칩, 흰 버튼 위에서는 노랑 칩 */
.lp-beta{ display:inline-flex; align-items:center; padding:2px 7px; border-radius:99px; background:#050038; color:#ffd02f; font-size:9.5px; font-weight:700; letter-spacing:.12em; line-height:1.4; vertical-align:middle; }
.lp .lp-btn .lp-beta-on-cta{ background:#ffd02f; color:#050038; }
.lp-beta-lg{ font-size:11px; padding:4px 10px; background:#ffd02f; color:#050038; }
.lp-mobile-menu .lp-beta{ margin-left:4px; }
.lp-beta-banner{ display:flex; align-items:flex-start; gap:14px; max-width:860px; margin:0 auto clamp(28px,4vw,44px); padding:16px 20px; border:1px solid #ffd02f4d; border-radius:var(--lp-r-lg);
  background:linear-gradient(135deg,#ffd02f14,#a78bfa0f); box-shadow:0 0 40px -16px #ffd02f66; }
.lp-beta-banner strong{ display:block; font-size:15px; font-weight:600; color:var(--lp-ink); margin-bottom:6px; }
.lp-beta-banner p{ margin:0; font-size:13.5px; line-height:1.7; color:var(--lp-text); }
.lp .lp-nav-cta:hover .lp-nav-cta-arrow{ transform:translateX(3px); }
.lp-burger{ display:none; margin-left:auto; background:transparent; border:0; padding:8px; cursor:pointer; flex-direction:column; gap:5px; }
.lp-burger span{ width:22px; height:2px; background:var(--lp-ink); display:block; }
.lp-mobile-menu{ position:absolute; left:0; right:0; top:100%; display:flex; flex-direction:column; gap:18px; padding:22px clamp(20px,4vw,48px) 26px; background:#0b0b10f2; backdrop-filter:blur(16px); border-bottom:1px solid var(--lp-line); }
.lp-mobile-menu[hidden]{ display:none; }
.lp-mobile-menu a{ font-weight:600; color:var(--lp-ink); }

/* ── 히어로 ── */
.lp-hero{ position:relative; padding-top:var(--lp-nav-h); background:transparent; overflow:hidden; display:flex; flex-direction:column; align-items:center; }
.lp-hero-body{ position:relative; z-index:2; width:100%; max-width:1040px; display:flex; flex-direction:column; align-items:center; text-align:center;
  padding:clamp(56px,9vh,110px) 20px 0; }
.lp-hero-sub{ margin:clamp(20px,3vh,30px) 0 0; max-width:560px; font-size:clamp(15px,1.7vw,19px); line-height:1.7; color:var(--lp-muted); animation:lp-rise .9s var(--lp-ease) both; animation-delay:.45s; }
.lp-hero-cta{ display:flex; flex-wrap:wrap; justify-content:center; gap:12px; padding:clamp(24px,4vh,40px) 0 0; animation:lp-rise .9s var(--lp-ease) both; animation-delay:.58s; }
.lp-hero-facts{ list-style:none; margin:clamp(28px,4.5vh,48px) 0 0; padding:0; display:flex; flex-wrap:wrap; justify-content:center; gap:0; animation:lp-rise .9s var(--lp-ease) both; animation-delay:.7s; }
.lp-hero-facts li{ display:flex; flex-direction:column; align-items:center; gap:8px; padding:0 22px; border-right:1px solid var(--lp-line); }
.lp-hero-facts li:last-child{ border-right:0; }
.lp-hero-facts strong{ font-size:clamp(22px,2.6vw,30px); font-weight:500; letter-spacing:-.03em; color:var(--lp-ink); }
.lp-hero-facts span{ font-size:14px; font-weight:500; letter-spacing:.02em; color:var(--lp-muted); }

.lp-hero-stage{ position:relative; z-index:2; width:100%; max-width:1160px; margin-top:clamp(56px,9vh,120px); padding:0 20px; scroll-margin-top:100px; }
.lp-hero-stage .lp-horizon{ bottom:auto; top:-40px; height:min(40vw,360px); z-index:0; }
.lp-hero-stage::before{ content:''; position:absolute; left:50%; top:-1px; width:min(900px,80%); height:1px; transform:translateX(-50%);
  background:linear-gradient(90deg,transparent,#a78bfa 30%,#fff 50%,#a78bfa 70%,transparent); box-shadow:var(--lp-glow); opacity:.9; }
.lp-hero-mock{ position:relative; z-index:1; animation:lp-rise 1.1s var(--lp-ease) both; animation-delay:.85s; }
.lp-hero-mock::after{ content:''; position:absolute; left:0; right:0; bottom:-1px; height:42%; pointer-events:none; border-radius:0 0 var(--lp-r-lg) var(--lp-r-lg);
  background:linear-gradient(180deg,transparent,#03071145 92%); }

/* ── 신뢰 스트립 ── */
.lp-trust{ border-top:1px solid var(--lp-line-soft); border-bottom:1px solid var(--lp-line-soft); background:transparent; padding:0 var(--lp-gutter); }
.lp-trust-list{ list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
.lp-trust-list li{ display:flex; align-items:center; gap:12px; padding:22px 18px 22px 0; border-right:1px solid var(--lp-line-soft); margin-right:18px; }
.lp-trust-list li:last-child{ border-right:0; margin-right:0; }
.lp-trust-icon{ width:38px; height:38px; flex:none; display:grid; place-items:center; border-radius:12px; background:var(--lp-card-2); border:1px solid var(--lp-line-soft); color:var(--lp-violet); }
.lp-trust-text{ display:flex; flex-direction:column; gap:2px; }
.lp-trust-text strong{ font-size:13.5px; font-weight:600; color:var(--lp-ink); }
.lp-trust-text span{ font-size:12px; color:var(--lp-muted); }

/* ── 제품 노트 ── */
.lp-product{ background:transparent; padding:clamp(70px,9vw,120px) var(--lp-gutter) clamp(40px,5vw,70px); }
.lp-product-notes{ list-style:none; max-width:1120px; margin:0 auto; padding:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
.lp-product-notes li{ display:flex; align-items:center; gap:12px; padding:16px 18px; border:1px solid var(--lp-line); border-radius:var(--lp-r-card); background:var(--lp-card); font-size:13px; color:var(--lp-muted); box-shadow:inset 0 1px 0 #ffffff0a; }
.lp-product-notes li strong{ display:block; font-size:13.5px; color:var(--lp-ink); }
.lp-product-notes .lp-ic{ color:var(--lp-violet); }

/* ── 앱 목업 ── */
.lp-mock{ position:relative; border:1px solid var(--lp-line); border-radius:var(--lp-r-lg); background:#07122250;
  box-shadow:0 40px 100px -30px #000,0 0 80px -20px #4f46e566; overflow:hidden; font-size:12px; color:var(--lp-text); }
.lp-mock-bar{ display:flex; align-items:center; gap:7px; padding:10px 14px; border-bottom:1px solid var(--lp-line-soft); background:#9fcaff08; }
.lp-mock-bar span{ width:10px; height:10px; border-radius:50%; background:#ffffff1f; }
.lp-mock-bar i{ margin-left:12px; font-style:normal; font-size:11px; color:var(--lp-soft); padding:4px 12px; border-radius:6px; background:#ffffff08; border:1px solid var(--lp-line-soft); }
.lp-mock-body{ display:grid; grid-template-columns:168px 1fr; min-height:440px; }
.lp-mock-side{ border-right:1px solid var(--lp-line-soft); padding:16px 12px; display:flex; flex-direction:column; gap:4px; background:#07122230; }
.lp-mock-side-logo{ display:flex; align-items:center; gap:8px; padding:4px 8px 16px; color:var(--lp-ink); }
.lp-mock-side-logo b{ font-weight:500; font-size:14px; letter-spacing:-.3px; }
.lp-mock-side span{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; color:var(--lp-muted); font-weight:500; }
.lp-mock-side span i{ width:14px; height:14px; border-radius:4px; border:1.5px solid currentColor; opacity:.7; }
.lp-mock-side span.is-on{ background:#ffffff0f; color:var(--lp-ink); }
.lp-mock-main{ padding:14px 18px 18px; display:flex; flex-direction:column; gap:14px; background:#0b0b10; }
.lp-mock-head{ display:flex; align-items:center; justify-content:space-between; }
.lp-mock-title{ font-size:15px; font-weight:600; color:var(--lp-ink); }
.lp-mock-title em{ font-style:normal; font-weight:500; color:var(--lp-soft); }
.lp-mock-user{ width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg,var(--lp-brand),var(--lp-violet)); }
.lp-mock-grid{ display:grid; grid-template-columns:repeat(12,1fr); gap:12px; }
.lp-mock-card{ background:var(--lp-card); border:1px solid var(--lp-line-soft); border-radius:14px; padding:14px; grid-column:span 4; min-height:120px; }
.lp-mock-card > p{ margin:0 0 10px; font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--lp-soft); }
.lp-mock-card > p em{ font-style:normal; font-weight:500; letter-spacing:0; text-transform:none; color:var(--lp-soft); }
.lp-mock-focus{ grid-column:span 5; background:linear-gradient(135deg,#1e1b4b,#0f0f1a 70%); border-color:#4f46e544; color:var(--lp-ink); }
.lp-mock-focus > p{ color:#c7d2fe99; }
.lp-mock-focus h4{ margin:0 0 14px; font-size:18px; font-weight:500; letter-spacing:-.02em; color:var(--lp-ink); }
.lp-mock-kpis{ display:flex; gap:16px; }
.lp-mock-kpis span{ display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:#c7d2fe99; }
.lp-mock-kpis b{ font-size:16px; font-weight:500; color:var(--lp-brand); }
.lp-mock-bars{ display:flex; align-items:flex-end; gap:8px; height:72px; }
.lp-mock-bars span{ flex:1; display:flex; align-items:flex-end; gap:2px; height:100%; }
.lp-mock-bars i{ flex:1; border-radius:3px 3px 0 0; background:#e4e4e7; transform-origin:bottom; animation:lp-grow 1.2s var(--lp-ease) both; }
.lp-mock-bars i + i{ background:var(--lp-indigo); opacity:.95; }
.lp-mock-donut-card{ grid-column:span 3; }
.lp-mock-donut{ width:72px; height:72px; margin:0 auto; border-radius:50%; display:grid; place-items:center;
  background:conic-gradient(#e4e4e7 0 42%,var(--lp-indigo) 42% 70%,var(--lp-brand) 70% 88%,#ffffff1f 88% 100%); }
.lp-mock-donut b{ width:46px; height:46px; border-radius:50%; background:#0b0b10; display:grid; place-items:center; font-weight:500; font-size:15px; color:var(--lp-ink); }
.lp-mock-board{ grid-column:span 7; }
.lp-mock-cols{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.lp-mock-cols > div{ display:flex; flex-direction:column; gap:6px; }
.lp-mock-colh{ font-size:10.5px; font-weight:600; color:var(--lp-muted); padding-bottom:4px; border-bottom:1px solid var(--lp-line-soft); }
.lp-mock-task{ display:flex; align-items:center; gap:7px; padding:8px 9px; border:1px solid var(--lp-line-soft); border-radius:9px; background:#ffffff08; font-weight:500; color:var(--lp-ink); }
.lp-mock-task i{ width:7px; height:7px; border-radius:50%; background:var(--lp-brand); box-shadow:0 0 6px var(--lp-brand); }
.lp-mock-chat{ grid-column:span 5; display:flex; flex-direction:column; gap:8px; }
.lp-mock-msg{ max-width:88%; padding:8px 11px; border-radius:12px; background:#ffffff0f; line-height:1.5; color:var(--lp-text); }
.lp-mock-msg-u{ align-self:flex-end; background:var(--lp-indigo); color:#fff; }
.lp-mock-input{ margin-top:auto; display:flex; align-items:center; justify-content:space-between; padding:8px 8px 8px 12px; border:1px solid var(--lp-line); border-radius:var(--lp-r-full); color:var(--lp-soft); background:#ffffff05; }
.lp-mock-input i{ width:22px; height:22px; border-radius:50%; background:var(--lp-ink); }

/* ── 어바웃 ── */
.lp-about{ display:flex; flex-wrap:wrap; align-items:center; gap:40px; position:relative; overflow:hidden;
  background:transparent;
  padding:clamp(60px,10vw,140px) 0 clamp(50px,7vw,100px) var(--lp-gutter); }
.lp-about-left{ flex:1 1 420px; min-width:300px; }
.lp-about-left .lp-p{ margin:32px 0 0 var(--lp-indent); }
.lp-about-left .lp-btn{ margin:36px 0 0 var(--lp-indent); }
.lp-about-right{ flex:1 1 360px; min-width:280px; position:relative; display:flex; justify-content:flex-end; overflow:hidden; }
.lp-tint{ position:absolute; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(120% 90% at 100% 50%,#4f46e52e 0%,transparent 70%); }

.lp-board{ width:100%; max-width:644px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px;
  padding:26px 26px 26px 22px; background:var(--lp-card-solid); border:1px solid var(--lp-line); border-radius:var(--lp-r-lg) 0 0 var(--lp-r-lg);
  border-right:0; box-shadow:-24px 24px 80px -30px #000,0 0 60px -20px #4f46e544; }
.lp-board-col{ display:flex; flex-direction:column; gap:10px; }
.lp-board-h{ margin:0 0 2px; display:flex; justify-content:space-between; font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--lp-muted); }
.lp-board-h span{ font-weight:500; color:var(--lp-soft); letter-spacing:0; }
.lp-board-card{ display:flex; flex-direction:column; gap:8px; padding:12px 13px; border:1px solid var(--lp-line-soft);
  background:var(--lp-card-2); border-radius:10px; transition:transform .25s var(--lp-ease),border-color .25s ease; }
.lp-board-card:hover{ transform:translateY(-2px); border-color:var(--lp-line-strong); }
.lp-board-t{ font-size:13px; font-weight:600; color:var(--lp-ink); }
.lp-board-meta{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.lp-board-tag{ font-size:10px; font-weight:700; letter-spacing:.06em; padding:3px 8px; border-radius:99px; background:var(--lp-brand-soft); color:var(--lp-brand); }
.lp-tag-high{ background:var(--lp-coral-soft); color:var(--lp-coral); }
.lp-tag-low{ background:#ffffff14; color:var(--lp-muted); }
.lp-board-who{ font-size:10.5px; color:var(--lp-soft); }
.lp-board-col:last-child .lp-board-card{ border-color:#4f46e566; }

/* ── 기능 (벤토) ── */
.lp-features{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter); overflow:hidden; }
.lp-features::before{ content:''; position:absolute; left:-10%; top:10%; width:50vw; height:50vw; max-width:700px; max-height:700px; border-radius:50%; pointer-events:none;
  background:radial-gradient(closest-side,#4f46e52e,transparent); filter:blur(60px); }
.lp-features > *{ position:relative; }
.lp-bento{ display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:14px; }
.lp-bcard{ grid-column:span 12; background:var(--lp-card); border:1px solid var(--lp-line); border-radius:var(--lp-r-feature); padding:clamp(20px,2.4vw,28px);
  display:flex; flex-direction:column; gap:18px; overflow:hidden; position:relative; box-shadow:inset 0 1px 0 #ffffff0a;
  transition:transform .35s var(--lp-ease),box-shadow .35s var(--lp-ease),border-color .35s ease,background .35s ease; }
.lp-bcard:hover{ transform:translateY(-4px); background:var(--lp-card-2); border-color:#a78bfa55; box-shadow:inset 0 1px 0 #ffffff14,0 0 60px -24px #4f46e5; }
.lp-bcard-art{ border-radius:calc(var(--lp-r-feature) - 10px); background:#0b0b10; border:1px solid var(--lp-line-soft); padding:12px; min-height:150px; display:grid; place-items:center; }
.lp-art{ width:100%; max-width:300px; height:auto; display:block; }
.lp-art-wide{ max-width:none; height:120px; }
.lp-bcard-body{ display:flex; flex-direction:column; gap:10px; }
.lp-card-k{ font-size:11px; font-weight:600; letter-spacing:.16em; color:var(--lp-violet); }
.lp-bcard h3{ margin:0; font-size:19px; font-weight:600; color:var(--lp-ink); letter-spacing:-.01em; }
.lp-bcard p{ margin:0; font-size:14px; line-height:1.7; color:var(--lp-muted); }
@media (min-width:720px){
  .lp-b-7,.lp-b-5{ grid-column:span 6; }
  .lp-b-4{ grid-column:span 6; }
  .lp-b-12{ grid-column:span 12; flex-direction:row-reverse; align-items:center; }
  .lp-b-12 .lp-bcard-art{ flex:1 1 55%; min-height:150px; }
  .lp-b-12 .lp-bcard-body{ flex:1 1 40%; }
}
@media (min-width:1080px){
  .lp-b-7{ grid-column:span 7; flex-direction:row; align-items:center; }
  .lp-b-7 .lp-bcard-art{ flex:1 1 52%; }
  .lp-b-7 .lp-bcard-body{ flex:1 1 44%; }
  .lp-b-5{ grid-column:span 5; }
  .lp-b-4{ grid-column:span 4; }
}
/* 일러스트 색 */
.lp-art-core{ fill:#1e1b4b; stroke:#4f46e5; stroke-width:1.5; }
.lp-art-core-t{ fill:var(--lp-brand); font-size:13px; font-weight:700; text-anchor:middle; letter-spacing:.08em; }
.lp-art-link{ fill:none; stroke:#a78bfa88; stroke-width:1.5; stroke-dasharray:4 4; animation:lp-dash 1.4s linear infinite; }
.lp-art-pill{ fill:#ffffff0a; stroke:var(--lp-line); }
.lp-art-pill-t{ fill:var(--lp-ink); font-size:12px; font-weight:600; }
.lp-art-center{ text-anchor:middle; }
.lp-art-dot-ink{ fill:#e4e4e7; } .lp-art-dot-mint{ fill:var(--lp-teal); } .lp-art-dot-brand{ fill:var(--lp-brand); }
.lp-art-layer{ fill:#ffffff0a; stroke:var(--lp-line-strong); }
.lp-art-layer-t{ fill:var(--lp-ink); font-size:11.5px; font-weight:600; }
.lp-art-badge{ fill:var(--lp-brand); }
.lp-art-badge-t{ fill:var(--lp-on-brand); font-size:11px; font-weight:700; text-anchor:middle; }
.lp-art-badge-alert{ fill:var(--lp-coral); } .lp-art-badge-alert + .lp-art-badge-t{ fill:#3b0a12; }
.lp-art-search{ fill:#ffffff0a; stroke:var(--lp-line-strong); }
.lp-art-search-ic{ fill:none; stroke:var(--lp-ink); stroke-width:1.8; stroke-linecap:round; }
.lp-art-search-t{ fill:var(--lp-ink); font-size:12px; font-weight:600; }
.lp-art-hit{ fill:#ffffff1a; } .lp-art-hit-hl{ fill:var(--lp-brand); }
.lp-art-doc{ fill:#ffffff08; stroke:var(--lp-line-strong); }
.lp-art-line{ fill:#ffffff1f; }
.lp-art-check{ fill:#6ee7b71a; stroke:var(--lp-success); stroke-width:1.5; }
.lp-art-check-m{ fill:none; stroke:var(--lp-success); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
.lp-art-rail{ fill:none; stroke:var(--lp-line-strong); stroke-width:2; stroke-dasharray:5 5; }
.lp-art-gate{ fill:#1e1b4b; stroke:#4f46e5; } .lp-art-gate-slot{ fill:var(--lp-brand); }
.lp-art-mover{ animation:lp-mover 3s var(--lp-ease) infinite; }
.lp-art-band{ fill:#4f46e52e; }
.lp-art-baseline{ fill:none; stroke:var(--lp-violet); stroke-width:1.2; stroke-dasharray:6 5; }
.lp-art-series{ fill:none; stroke:#fafafa; stroke-width:2; stroke-linecap:round; stroke-dasharray:900; stroke-dashoffset:900; animation:lp-draw 2.4s var(--lp-ease) forwards; }
.lp-art-alert{ fill:var(--lp-coral); stroke:#fff; stroke-width:1.5; animation:lp-blink 1.6s ease-in-out infinite; }

/* ── 작동 방식 ── */
.lp-how{ background:transparent; color:var(--lp-ink); padding:clamp(70px,9vw,130px) var(--lp-gutter); overflow:hidden; border-top:1px solid var(--lp-line-soft); }
.lp-how::after{ content:''; position:absolute; right:-10%; top:-10%; width:52vw; height:52vw; max-width:760px; max-height:760px; border-radius:50%;
  background:radial-gradient(closest-side,#4f46e540,transparent); filter:blur(40px); pointer-events:none; }
.lp-how > *{ position:relative; z-index:1; }
.lp-steps{ list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr; gap:clamp(24px,3vw,44px); }
@media (min-width:720px){ .lp-steps{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (min-width:1080px){ .lp-steps{ grid-template-columns:repeat(4,minmax(0,1fr)); } }
.lp-steps li{ position:relative; padding-top:26px; }
.lp-step-track{ position:absolute; left:0; right:0; top:0; height:2px; background:var(--lp-line); border-radius:2px; overflow:hidden; }
.lp-step-track i{ position:absolute; inset:0; background:linear-gradient(90deg,var(--lp-violet),var(--lp-brand)); transform:scaleX(0); transform-origin:left; transition:transform 1.1s var(--lp-ease); transition-delay:calc(var(--d,0) * 260ms + 200ms); }
.lp-steps li.is-in .lp-step-track i,.lp:not(.lp-js) .lp-step-track i{ transform:scaleX(1); }
.lp-step-n{ font-size:12px; font-weight:700; letter-spacing:.16em; color:var(--lp-brand); }
.lp-step-chip{ display:inline-block; margin-left:10px; font-size:10.5px; font-weight:600; letter-spacing:.06em; padding:3px 9px; border-radius:99px; background:#ffffff14; color:var(--lp-muted); }
.lp-steps h3{ margin:12px 0 8px; font-size:18px; font-weight:600; color:var(--lp-ink); }
.lp-steps p{ margin:0; font-size:14px; line-height:1.75; color:var(--lp-muted); }

.lp-convo{ margin:clamp(40px,5vw,64px) auto 0; max-width:720px; display:flex; flex-direction:column; gap:12px; padding:20px; border:1px solid var(--lp-line); border-radius:var(--lp-r-feature); background:#09090b99; backdrop-filter:blur(10px); box-shadow:inset 0 1px 0 #ffffff0a,0 0 80px -30px #4f46e5; }
.lp-msg{ max-width:82%; padding:12px 16px; border-radius:18px; background:#ffffff0f; }
.lp-msg p{ margin:0; font-size:14px; line-height:1.6; color:var(--lp-ink); }
.lp-msg-who{ display:inline-flex; align-items:center; gap:6px; margin-bottom:6px; font-size:11px; font-weight:600; letter-spacing:.06em; color:var(--lp-muted); }
.lp-msg-user{ align-self:flex-end; background:var(--lp-indigo); }
.lp-msg-user p{ color:#fff; } .lp-msg-user .lp-msg-who{ color:#c7d2fe; }
.lp-msg-cards{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.lp-msg-cards span{ font-size:12px; padding:8px 12px; border-radius:10px; background:#ffffff0a; border:1px solid var(--lp-line); color:var(--lp-muted); }
.lp-msg-cards b{ display:block; font-weight:600; color:var(--lp-ink); }
.lp-msg-report{ border-left:3px solid var(--lp-teal); }

/* ── 크루 ── */
.lp-crew{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter); }
.lp-crew-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; }
.lp-crew-card{ position:relative; padding:24px; border:1px solid var(--lp-line); border-radius:var(--lp-r-feature); background:var(--lp-card); display:flex; flex-direction:column; gap:10px; box-shadow:inset 0 1px 0 #ffffff0a;
  transition:transform .35s var(--lp-ease),box-shadow .35s var(--lp-ease),border-color .35s ease; }
.lp-crew-card:hover{ transform:translateY(-4px); border-color:#a78bfa55; box-shadow:inset 0 1px 0 #ffffff14,0 0 60px -24px #4f46e5; }
.lp-crew-avatar{ width:52px; height:52px; display:grid; place-items:center; border-radius:16px; background:#ffffff0a; color:var(--lp-ink); }
.lp-crew-brand .lp-crew-avatar{ background:var(--lp-brand); color:var(--lp-on-brand); box-shadow:0 0 28px -6px var(--lp-brand); }
.lp-crew-mint .lp-crew-avatar{ color:var(--lp-teal); }
.lp-crew-coral .lp-crew-avatar{ color:var(--lp-coral); background:var(--lp-coral-soft); }
.lp-crew-dash .lp-crew-avatar{ color:var(--lp-muted); background:transparent; border:1.5px dashed var(--lp-line-strong); }
.lp-crew-dash{ border-style:dashed; background:transparent; }
.lp-crew-tag{ position:absolute; top:22px; right:22px; font-size:10.5px; font-weight:600; letter-spacing:.06em; padding:4px 9px; border-radius:99px; background:#ffffff0f; color:var(--lp-muted); }
.lp-crew-brand .lp-crew-tag{ background:var(--lp-brand-soft); color:var(--lp-brand); }
.lp-crew-card h3{ margin:6px 0 0; font-size:18px; font-weight:600; color:var(--lp-ink); }
.lp-crew-card p{ margin:0; font-size:13.5px; line-height:1.7; color:var(--lp-muted); }

/* ── 비교표 ── */
.lp-compare{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter); border-top:1px solid var(--lp-line-soft); }
.lp-table-wrap{ max-width:1000px; margin:0 auto; overflow-x:auto; border:1px solid var(--lp-line); border-radius:var(--lp-r-feature); background:var(--lp-card); box-shadow:inset 0 1px 0 #ffffff0a,0 0 80px -30px #4f46e5; }
.lp-table{ width:100%; min-width:640px; border-collapse:separate; border-spacing:0; font-size:14px; }
.lp-table th,.lp-table td{ padding:16px 18px; text-align:left; border-bottom:1px solid var(--lp-line-soft); vertical-align:top; }
.lp-table thead th{ font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--lp-muted); background:#ffffff05; }
.lp-table tbody th{ font-weight:600; color:var(--lp-ink); white-space:nowrap; width:1%; }
.lp-table td{ color:var(--lp-muted); }
.lp-table tr:last-child th,.lp-table tr:last-child td{ border-bottom:0; }
.lp-table .is-us{ background:var(--lp-indigo-soft); color:var(--lp-ink); font-weight:500; }
.lp-table thead .is-us{ background:linear-gradient(90deg,var(--lp-indigo),#7c3aed); color:#fff; text-transform:none; letter-spacing:-.2px; font-size:14px; }
.lp-th-us,.lp-td-us{ display:inline-flex; align-items:center; gap:8px; }
.lp-td-us .lp-ic{ width:16px; height:16px; color:var(--lp-success); }

/* ── 시작 안내 ── */
.lp-pricing{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter) clamp(40px,5vw,64px); border-top:1px solid var(--lp-line-soft); }
.lp-plans{ display:grid; grid-template-columns:1fr; gap:18px; max-width:1120px; margin:0 auto; }
@media (min-width:860px){ .lp-plans{ grid-template-columns:repeat(3,minmax(0,1fr)); align-items:stretch; } }
.lp-plan{ display:flex; flex-direction:column; padding:28px 26px 26px; border:1px solid var(--lp-line); border-radius:var(--lp-r-lg); background:var(--lp-card); box-shadow:inset 0 1px 0 #ffffff0a; transition:border-color .25s ease,transform .3s var(--lp-ease),box-shadow .3s ease; }
.lp-plan:hover{ border-color:#a78bfa66; transform:translateY(-3px); box-shadow:inset 0 1px 0 #ffffff14,0 0 50px -20px #4f46e5; }
.lp-plan-featured{ border-color:#a78bfa88; background:linear-gradient(180deg,#4f46e51a,#fafafa05 60%); box-shadow:inset 0 1px 0 #ffffff1a,0 0 70px -24px #6366f1; }
.lp-plan-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.lp-plan-head h3{ margin:0; font-size:15px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--lp-muted); }
.lp-plan-tag{ font-size:10.5px; font-weight:600; letter-spacing:.06em; padding:4px 10px; border-radius:99px; background:#ffffff14; color:var(--lp-text); }
.lp-plan-featured .lp-plan-tag{ background:var(--lp-brand); color:var(--lp-on-brand); }
.lp-plan-price{ margin:18px 0 0; font-size:clamp(26px,2.6vw,32px); font-weight:600; letter-spacing:-.02em; color:var(--lp-ink); line-height:1.15; }
.lp-plan-unit{ margin:6px 0 0; font-size:13px; color:var(--lp-muted); }
.lp-plan-d{ margin:16px 0 0; font-size:14px; line-height:1.7; color:var(--lp-text); }
.lp-plan-perks{ list-style:none; margin:18px 0 26px; padding:0; display:flex; flex-direction:column; gap:9px; flex:1; }
.lp-plan-perks li{ display:flex; align-items:flex-start; gap:10px; font-size:13.5px; line-height:1.5; color:var(--lp-text); }
.lp-plan-perks .lp-ic{ flex:none; width:16px; height:16px; margin-top:2px; color:var(--lp-success); }
.lp-plan .lp-btn{ justify-content:center; }
.lp-plan-note{ max-width:760px; margin:clamp(28px,4vw,40px) auto 0; text-align:center; font-size:14px; line-height:1.7; color:var(--lp-text); }
.lp-plan-note a{ color:var(--lp-ink); text-decoration:underline; text-underline-offset:3px; white-space:nowrap; }
.lp-plan-rate{ max-width:760px; margin:10px auto 0; text-align:center; font-size:12.5px; color:var(--lp-muted); }
.lp-start{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter); display:grid; grid-template-columns:1fr; gap:clamp(32px,5vw,72px); align-items:start; }
@media (min-width:900px){ .lp-start{ grid-template-columns:minmax(0,1fr) minmax(0,1.1fr); } }
.lp-start-left .lp-p{ margin:16px 0 0; }
.lp-start-perks{ list-style:none; margin:24px 0 32px; padding:0; display:flex; flex-direction:column; gap:10px; }
.lp-start-perks li{ display:flex; align-items:center; gap:10px; font-size:14px; color:var(--lp-text); }
.lp-start-perks .lp-ic{ width:18px; height:18px; color:var(--lp-success); }
.lp-start-steps{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
.lp-start-steps li{ display:flex; gap:18px; padding:22px 24px; border:1px solid var(--lp-line); border-radius:var(--lp-r-lg); background:var(--lp-card); box-shadow:inset 0 1px 0 #ffffff0a; transition:border-color .25s ease,transform .3s var(--lp-ease),box-shadow .3s ease; }
.lp-start-steps li:hover{ border-color:#a78bfa66; transform:translateX(4px); box-shadow:inset 0 1px 0 #ffffff14,0 0 50px -20px #4f46e5; }
.lp-start-n{ flex:none; width:36px; height:36px; border-radius:50%; display:grid; place-items:center; background:var(--lp-ink); color:var(--lp-on-cta); font-weight:600; font-size:14px; }
.lp-start-steps li:nth-child(2) .lp-start-n{ background:var(--lp-brand); color:var(--lp-on-brand); box-shadow:0 0 22px -4px var(--lp-brand); }
.lp-start-steps h3{ margin:6px 0 6px; font-size:16.5px; font-weight:600; color:var(--lp-ink); }
.lp-start-steps p{ margin:0; font-size:13.5px; line-height:1.7; color:var(--lp-muted); }

/* ── FAQ ── */
.lp-faq{ background:transparent; padding:clamp(70px,9vw,130px) var(--lp-gutter); border-top:1px solid var(--lp-line-soft); }
.lp-faq-list{ max-width:820px; display:flex; flex-direction:column; gap:10px; }
.lp-faq-item{ border:1px solid var(--lp-line); border-radius:var(--lp-r-lg); background:var(--lp-card); overflow:hidden; transition:border-color .25s ease,background .25s ease; }
.lp-faq-item[open]{ border-color:#a78bfa66; background:var(--lp-card-2); }
.lp-faq-item summary{ list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 22px; font-size:15.5px; font-weight:600; color:var(--lp-ink); }
.lp-faq-item summary::-webkit-details-marker{ display:none; }
.lp-faq-plus{ position:relative; flex:none; width:26px; height:26px; border-radius:50%; background:#ffffff0f; transition:transform .3s var(--lp-ease),background .2s ease; }
.lp-faq-plus::before,.lp-faq-plus::after{ content:''; position:absolute; left:50%; top:50%; width:11px; height:1.6px; background:var(--lp-ink); transform:translate(-50%,-50%); }
.lp-faq-plus::after{ transform:translate(-50%,-50%) rotate(90deg); }
.lp-faq-item[open] .lp-faq-plus{ transform:rotate(45deg); background:var(--lp-brand); }
.lp-faq-item[open] .lp-faq-plus::before,.lp-faq-item[open] .lp-faq-plus::after{ background:var(--lp-on-brand); }
.lp-faq-item p{ margin:0; padding:0 22px 20px; font-size:14px; line-height:1.75; color:var(--lp-muted); }

/* ── CTA · 푸터 ── */
.lp-cta{ position:relative; overflow:hidden; background:transparent; padding:clamp(100px,12vw,180px) var(--lp-gutter); display:flex; flex-direction:column; align-items:center; gap:26px; text-align:center; }
.lp-cta > *{ position:relative; z-index:1; }
.lp-cta-bg{ position:absolute; inset:0; z-index:0; pointer-events:none; display:grid; place-items:center; }
.lp-cta-bg .lp-stars{ opacity:.5; }
.lp-cta-ring{ position:absolute; border:1px solid #a78bfa33; border-radius:50%; width:40vw; height:40vw; max-width:560px; max-height:560px; animation:lp-ring 9s ease-out infinite; }
.lp-cta-ring:nth-child(3){ animation-delay:-3s; }
.lp-cta-ring:nth-child(4){ animation-delay:-6s; }
.lp-horizon-cta{ opacity:.8; }
.lp-h2-center{ align-items:center; }
.lp-p-center{ margin:0; }
.lp-footer{ background:transparent; border-top:1px solid var(--lp-line); padding:44px var(--lp-gutter) 30px;
  display:flex; flex-direction:column; gap:28px; font-size:12px; color:var(--lp-muted); }
.lp-footer-top{ display:grid; grid-template-columns:1fr; gap:28px; }
@media (min-width:720px){ .lp-footer-top{ grid-template-columns:1.6fr 1fr 1fr; } }
.lp-footer-brand{ display:flex; flex-wrap:wrap; align-items:center; align-content:flex-start; gap:12px; }
.lp-footer-mark{ width:30px; height:30px; }
.lp-footer-word{ font-size:20px; }
.lp-footer-tag{ flex-basis:100%; color:var(--lp-soft); }
.lp-footer-col{ display:flex; flex-direction:column; gap:8px; }
.lp-footer-col p{ margin:0 0 4px; font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--lp-soft); }
.lp .lp-footer-col a{ color:var(--lp-muted); font-size:13px; }
.lp .lp-footer-col a:hover{ color:var(--lp-ink); }
.lp-footer-legal{ margin:0; padding-top:18px; border-top:1px solid var(--lp-line-soft); font-size:11.5px; line-height:1.7; color:var(--lp-soft); }

/* ── 궤도 SVG ── */
.lp-orbit{ width:100%; height:auto; display:block; }
.lp-ring{ fill:none; stroke:#c7d2fe; stroke-width:1; }
.lp-ring-dash{ stroke-dasharray:3 7; stroke-linecap:round; }
.lp-spokes line{ stroke:#c7d2fe; stroke-width:1; opacity:.15; }
.lp-node-ink{ fill:#fafafa; }
.lp-node-brand{ fill:var(--lp-brand); }
.lp-node-mint{ fill:var(--lp-teal); }
.lp-node{ filter:drop-shadow(0 0 6px currentColor); }
.lp-spin{ transform-origin:310px 310px; }
.lp-spin-a{ animation:lp-rot 34s linear infinite; }
.lp-spin-b{ animation:lp-rot 24s linear infinite reverse; }
.lp-spin-c{ animation:lp-rot 16s linear infinite; }
.lp-counter-a{ animation:lp-rot 34s linear infinite reverse; transform-box:fill-box; transform-origin:center; }
.lp-chip{ fill:#09090bcc; stroke:var(--lp-line-strong); }
.lp-chip-t{ fill:var(--lp-ink); font-size:12px; font-weight:600; text-anchor:middle; }
.lp-core-ring{ fill:none; stroke:#a78bfa66; stroke-width:1; }
.lp-pulse{ fill:none; stroke:var(--lp-violet); stroke-width:1; opacity:.5; animation:lp-pulse 3.6s ease-out infinite; transform-origin:310px 310px; }
.lp-pulse-2{ animation-delay:-1.8s; }
.lp-core-t1{ fill:#fff; font-size:13px; font-weight:700; letter-spacing:.16em; text-anchor:middle; }
.lp-core-t2{ fill:var(--lp-brand); font-size:11.5px; letter-spacing:-.02em; text-anchor:middle; }
.lp-hero-orbit .lp-core-t1,.lp-hero-orbit .lp-core-t2,.lp-hero-orbit .lp-chip-g{ display:none; }

@keyframes lp-rot{ to{ transform:rotate(360deg); } }
@keyframes lp-pulse{ 0%{ transform:scale(.82); opacity:.55; } 70%{ transform:scale(1.18); opacity:0; } 100%{ opacity:0; } }
@keyframes lp-rise{ from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:none; } }
@keyframes lp-blink{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
@keyframes lp-twinkle{ 0%,100%{ opacity:.55; } 50%{ opacity:.2; } }
@keyframes lp-drift{ from{ transform:translate(-50%,0); } to{ transform:translate(-46%,4%); } }
@keyframes lp-dash{ to{ stroke-dashoffset:-16; } }
@keyframes lp-draw{ to{ stroke-dashoffset:0; } }
@keyframes lp-grow{ from{ transform:scaleY(0); } to{ transform:scaleY(1); } }
@keyframes lp-mover{ 0%{ transform:translateX(0); opacity:1; } 45%{ transform:translateX(66px); opacity:1; } 60%{ transform:translateX(66px); opacity:0; } 100%{ transform:translateX(0); opacity:0; } }
@keyframes lp-ring{ 0%{ transform:scale(.4); opacity:0; } 20%{ opacity:.9; } 100%{ transform:scale(1.9); opacity:0; } }
.lp-nebula-b{ animation-name:lp-drift-b; }
@keyframes lp-drift-b{ from{ transform:translate(0,0); } to{ transform:translate(-6%,8%); } }
@media (prefers-reduced-motion:reduce){
  .lp-spin,.lp-counter-a,.lp-pulse,.lp-nebula,.lp-stars,.lp-dot,.lp-art-link,.lp-art-mover,.lp-art-alert,.lp-cta-ring,.lp-mock-bars i{ animation:none; }
  .lp-h1-line,.lp-hero-sub,.lp-hero-cta,.lp-hero-facts,.lp-hero-mock{ animation:none; }
  .lp-art-series{ stroke-dashoffset:0; animation:none; }
}

/* ── 모바일 ── */
@media (max-width:700px){
  .lp{ --lp-indent:34px; --lp-nav-h:64px; }
  .lp .lp-nav-links,.lp .lp-nav-cta,.lp .lp-nav > .lp-lang{ display:none; }
  .lp-burger{ display:flex; }
  .lp-hero-body{ padding-top:40px; }
  .lp-h1{ font-size:clamp(34px,10.5vw,56px); }
  .lp-h1-line{ display:block; }
  .lp-hero-facts li{ padding:0 12px; }
  .lp-hero-stage{ margin-top:44px; padding:0 12px; }
  .lp-trust-list li{ border-right:0; margin-right:0; padding:14px 0; border-bottom:1px solid var(--lp-line-soft); }
  .lp-trust-list li:last-child{ border-bottom:0; }
  .lp-mock-body{ grid-template-columns:1fr; }
  .lp-mock-side{ display:none; }
  .lp-mock-card,.lp-mock-focus,.lp-mock-donut-card,.lp-mock-board,.lp-mock-chat{ grid-column:span 12; }
  .lp-about{ padding-right:0; }
  .lp-about-left .lp-p,.lp-about-left .lp-btn{ margin-left:34px; }
  .lp-in2{ padding-left:34px; }
  .lp-board{ padding:16px 16px 16px 14px; gap:8px; }
  .lp-board-card{ padding:9px 10px; }
  .lp-board-t{ font-size:12px; }
  .lp-crew-tag{ position:static; align-self:flex-start; }
  .lp-convo{ padding:14px; }
  .lp-msg{ max-width:94%; }
}

.lp-offer-note{font-size:14px;line-height:1.7;color:#aaa5b7;max-width:720px;margin:20px auto;}
.lp-model-story{display:grid;grid-template-columns:1.15fr 1fr;gap:56px;padding:80px var(--lp-gutter);align-items:center;}
.lp-model-story .lp-offer-note{margin-left:0;}
.lp-model-flow{padding:32px;border:1px solid #62548b;border-radius:20px;background:linear-gradient(145deg,#728fb91c,#101b3038);}
.lp-model-flow>span{color:#ffd02f;font-size:14px;}.lp-model-flow h3{font-size:24px;line-height:1.5;}
.lp-model-flow ol{padding-left:22px;color:#ccc5db;line-height:2.4;font-size:16px;}
.lp-free-offer{display:flex;gap:36px;align-items:center;justify-content:space-between;padding:36px;margin:32px 0;border:1px solid #ffd02f70;border-radius:18px;background:#ffd02f09;}
.lp-free-offer h3{font-size:clamp(24px,3vw,36px);margin:0 0 16px;}.lp-free-offer p:not(.lp-eyebrow){font-size:16px;line-height:1.8;max-width:700px;color:#aaa5b7;}.lp-free-offer .lp-btn{flex-shrink:0;}
.lp-h1{line-height:1.16;word-break:keep-all;}.lp-hero-facts strong{font-size:clamp(18px,2vw,24px);}.lp-hero-facts{row-gap:24px;}
@media(max-width:760px){.lp-model-story{grid-template-columns:1fr;gap:24px;padding:48px var(--lp-gutter);}.lp-free-offer{flex-direction:column;align-items:flex-start;padding:24px;}.lp-model-flow{padding:24px;}.lp-hero-facts{flex-wrap:wrap;}.lp-offer-note{padding:0 12px;}}

/* Continuous deep-space canvas; the glass surfaces share one backdrop. */
.lp{isolation:isolate;background:#030711;}
.lp-universe{position:fixed;inset:0;z-index:-1;pointer-events:none;background:#030711 url('/orbit-space.webp') center center/cover no-repeat;}
.lp-universe::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#02061220,#02061248 50%,#02061270);}
.lp .lp-space{opacity:1;}
.lp .lp-space > .lp-stars{opacity:.22;}
.lp-hero-orbit{opacity:.85;
 -webkit-mask-image:radial-gradient(circle at 50% 50%,#0000 8%,#0005 25%,#000 52%,#000b 66%,#0000 73%);
 mask-image:radial-gradient(circle at 50% 50%,#0000 8%,#0005 25%,#000 52%,#000b 66%,#0000 73%);
}
.lp-nebula,.lp-features::before,.lp-how::after{display:none;}
.lp-horizon{opacity:.25;}
.lp-hero-body{padding-top:clamp(90px,14vh,160px);padding-bottom:24px;}
.lp-h1{font-weight:500;letter-spacing:-.055em;text-shadow:0 8px 48px #02061288;}
.lp-hero-sub{max-width:650px;color:#c1ccdc;}
.lp-eyebrow-pill{background:#9ecfff08;border-color:#c0deff30;backdrop-filter:blur(12px);}
.lp-hero-facts{padding:22px 12px;border:1px solid #bcdbff26;border-radius:22px;background:#bedaff06;backdrop-filter:blur(12px);}
.lp :is(.lp-bcard,.lp-crew-card,.lp-plan,.lp-start-steps li,.lp-faq-item,.lp-product-notes li,.lp-model-flow,.lp-free-offer,.lp-convo,.lp-board,.lp-mock){
 background:linear-gradient(135deg,#ecf5ff10 0%,#c0dbff03 38%,#bad5ff07 100%),#0c182c35;
 border-color:#dcecff30;border-top-color:#f1f8ff55;border-left-color:#e0efff3b;
 backdrop-filter:blur(22px) saturate(135%);-webkit-backdrop-filter:blur(22px) saturate(135%);
 box-shadow:inset 0 1px 0 #ffffff24,inset 0 -1px 0 #bbd8ff0c,inset 1px 0 0 #ffffff0a,0 16px 48px -24px #0009;
}
.lp :is(.lp-bcard,.lp-crew-card,.lp-plan):hover{background-color:#b4d3ff0d;border-color:#c3ddff55;box-shadow:inset 0 1px 0 #ffffff38,inset 0 -1px 0 #c3ddff14,0 22px 60px -28px #1c76ae55;}
.lp .lp-bcard-art{background:#a8d1ff04;border-color:#c3ddff12;}
.lp .lp-plan-featured{background:linear-gradient(145deg,#dceeff1b,#bca4ff08 60%),#0c182c35;border-color:#b7d8ff55;border-top-color:#e4f3ff77;}
.lp .lp-model-flow{border-color:#b7d8ff40;}
.lp .lp-free-offer{background:linear-gradient(120deg,#ffd02f0b,#b4d3ff06);border-color:#ffd02f40;}
.lp .lp-trust{background:#adcdff04;border-color:#c3ddff14;}
.lp .lp-nav{background:#08122328;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid #c3ddff12;}
.lp .lp-nav.is-stuck{background:#081223a0;}
.lp .lp-mobile-menu{background:#071222eb;}
.lp :is(.lp-pricing,.lp-how,.lp-faq,.lp-footer){border-color:#c3ddff14;}
.lp .lp-hero-mock{max-width:1120px;margin-inline:auto;}
.lp .lp-mock{border-color:#c3ddff45;box-shadow:inset 0 1px 0 #ffffff40,inset 0 -1px 0 #d1e8ff12,0 30px 100px -35px #000a,0 0 90px -55px #99d7ff;}
.lp .lp-mock-focus{background:linear-gradient(135deg,#82b4ff1c,#9f8eff08);}
.lp .lp-footer{background:#03071130;}
.lp .lp-cta-bg{opacity:.4;}
@media(max-width:700px){
 .lp-hero-body{padding-top:80px;}
 .lp-hero-facts{gap:20px;padding:22px;}
 .lp-hero-facts li{border:0;width:100%;}
 .lp :is(.lp-bcard,.lp-crew-card,.lp-plan,.lp-start-steps li,.lp-faq-item){backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%);background-color:#0c182c65;}
}
@media(prefers-reduced-motion:reduce){.lp-universe{animation:none;}}

/* Soft edge reflections, without a bright overlay over the content. */
.lp :is(.lp-bcard,.lp-crew-card,.lp-plan,.lp-model-flow,.lp-convo){border-radius:28px;}
.lp .lp-mock{border-radius:26px;}
.lp .lp-mock-bar{background:linear-gradient(180deg,#e7f4ff0d,#d6eaff03);border-bottom-color:#e1f0ff1c;}
.lp .lp-bcard-art{background:linear-gradient(145deg,#d7ebff06,#a8d1ff02);border-top-color:#e1f0ff20;}
.lp .lp-hero-facts{background:linear-gradient(140deg,#e6f4ff0e,#bedaff03 60%);border-top-color:#e6f4ff45;box-shadow:inset 0 1px 0 #ffffff18,0 12px 36px -24px #0008;backdrop-filter:blur(18px) saturate(130%);-webkit-backdrop-filter:blur(18px) saturate(130%);}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
 .lp :is(.lp-bcard,.lp-crew-card,.lp-plan,.lp-start-steps li,.lp-faq-item,.lp-product-notes li,.lp-model-flow,.lp-free-offer,.lp-convo,.lp-board,.lp-mock,.lp-hero-facts){background-color:#0c182cdd;}
}

/* Crisp orbital signals remain behind the headline; no whole-layer blur. */
.lp-hero-orbit .lp-ring{stroke:#a9d8fa;stroke-width:.7;}
.lp-hero-orbit .lp-ring-dash{stroke-dasharray:1 9;stroke-width:1;}
.lp-hero-orbit .lp-spin-a{animation-duration:42s;}
.lp-hero-orbit .lp-spin-b{animation-duration:29s;}
.lp-hero-orbit .lp-spin-c{animation-duration:20s;}
.lp-hero-orbit .lp-node{r:3px;opacity:.7;}
.lp-hero-orbit .lp-spokes{opacity:.35;}
.lp-signal-head{filter:drop-shadow(0 0 3px currentColor) drop-shadow(0 0 8px currentColor);}
@media(max-width:700px){.lp-hero-orbit{width:145vw;opacity:.65;}}
@media(prefers-reduced-motion:reduce){.lp-hero-orbit .lp-spin{animation:none;}.lp-signal.lp-spin-b{transform:rotate(120deg);}}

/* Fine particle wakes use the same motion path as their satellites. */

.lp-satellite-still{display:none;}

.lp-hero-orbit{opacity:.9;-webkit-mask-image:radial-gradient(ellipse at center,#0007 15%,#000 45%,#000 65%,transparent 76%);mask-image:radial-gradient(ellipse at center,#0007 15%,#000 45%,#000 65%,transparent 76%);}
@media(prefers-reduced-motion:reduce){.lp-satellite,.lp-satellite-particle{display:none;}.lp-satellite-still{display:block;}}

/* The textured star turns independently of the satellites around it. */
.lp-central-star{mix-blend-mode:screen;pointer-events:none;}
.lp-star-surface{transform-origin:310px 310px;animation:lp-star-turn 100s linear infinite;}
@keyframes lp-star-turn{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.lp-star-surface{animation:none;}}

/* Surface movement across a shaded sphere suggests axial rotation in depth. */
.lp-star-sphere{position:relative;width:112px;height:112px;overflow:hidden;border-radius:50%;background:#df991e;box-shadow:0 0 8px #ffda8aaa,0 0 24px #ffb33b55,0 0 48px #ffa32222;}
.lp-star-texture{position:absolute;inset:0;border-radius:inherit;background-image:url('/orbit-star.webp');background-size:230% 230%;background-position:30% 50%;animation:lp-star-axis 36s ease-in-out infinite alternate;}
.lp-star-shading{position:absolute;inset:0;border-radius:inherit;background:radial-gradient(circle at 32% 28%,#fff4c52b,transparent 40%,#7b310540 74%,#321500bb 100%);box-shadow:inset -12px -3px 22px #431d0066,inset 2px 1px 5px #fff0ad80;}
@keyframes lp-star-axis{from{background-position:30% 50%;}to{background-position:70% 50%;}}
@media(prefers-reduced-motion:reduce){.lp-star-texture{animation:none;}}

/* Small independently phased eddies break up the evenly spaced orbital trail. */
.lp-dust-cloud{animation:lp-dust-eddy var(--dust-duration) ease-in-out infinite;animation-delay:var(--dust-delay);}
@keyframes lp-dust-eddy{
 0%,100%{transform:translate(0,0);}
 27%{transform:translate(var(--dust-x),calc(var(--dust-y) * -.7));}
 61%{transform:translate(calc(var(--dust-x) * -.65),var(--dust-y));}
 83%{transform:translate(calc(var(--dust-x) * .35),calc(var(--dust-y) * .25));}
}
@media(prefers-reduced-motion:reduce){.lp-dust-cloud{animation:none;}}

/* Maintain readable contrast on glass without obscuring the space backdrop. */
.lp .lp-model-flow h3,.lp .lp-free-offer h3{color:var(--lp-ink);line-height:1.35;}
.lp .lp-free-offer p:not(.lp-eyebrow),.lp .lp-offer-note{color:#c1ccdc;}
.lp :is(.lp-bcard,.lp-crew-card,.lp-plan,.lp-start-steps li,.lp-faq-item,.lp-product-notes li,.lp-model-flow,.lp-free-offer,.lp-convo){background-color:#071222a6;}
.lp .lp-beta-banner{background-color:#071222c4;}
.lp :is(.lp-bcard p,.lp-crew-card p,.lp-steps p,.lp-start-steps p,.lp-faq-item p,.lp-plan-d){font-size:16px;line-height:1.75;}
.lp :is(.lp-trust-text span,.lp-product-notes li,.lp-plan-unit,.lp-plan-rate,.lp-footer,.lp-crew-tag,.lp-step-chip){font-size:14px;}
.lp :is(.lp-trust-text strong,.lp-product-notes li strong){font-size:15px;}
.lp .lp-footer-tag{color:var(--lp-muted);}
.lp :is(.lp-model-story,.lp-free-offer)>div{min-width:0;}
.lp :is(h1,h2,h3,p){overflow-wrap:break-word;}
.lp a:focus-visible,.lp button:focus-visible,.lp summary:focus-visible{outline:2px solid #ffd76a;outline-offset:5px;}
@media(max-width:700px){.lp-about-left{min-width:0;}.lp-about .lp-h2{font-size:clamp(28px,8vw,44px);}.lp-in2{padding-left:0;}.lp-about-left .lp-p,.lp-about-left .lp-btn{margin-left:0;}.lp-about-left{padding-right:var(--lp-gutter);}}

@media(max-width:700px){
 .lp-beta-banner{flex-direction:column;gap:10px;}.lp-beta-banner p{font-size:14px;}
 .lp-about-right{min-width:0;padding-right:var(--lp-gutter);}
 .lp-board{grid-template-columns:1fr;border-right:1px solid var(--lp-line);border-radius:20px;}
 .lp-board-col{min-width:0;}.lp-board-meta{flex-wrap:wrap;gap:8px;}
 .lp-board-t{font-size:14px;}.lp-board-who{font-size:12px;}
}
`;

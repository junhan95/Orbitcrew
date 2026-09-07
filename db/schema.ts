import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  description: text('description').notNull().default(''), color: text('color').notNull().default('#181d26'),
  status: text('status').notNull().default('진행 중'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_projects_user_updated').on(table.userId, table.updatedAt)]);

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  role: text('role').notNull(), description: text('description').notNull(), instructions: text('instructions').notNull(),
  // NULL 이면 .env 의 ANTHROPIC_MODEL 을 씁니다. 값이 있으면 이 에이전트만 그 모델로 실행됩니다.
  model: text('model'),
  color: text('color').notNull().default('#181d26'), isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  // 에이전트는 프로젝트에 귀속됩니다. NULL 이면 어느 프로젝트에도 속하지 않은 공용 에이전트.
  projectId: text('project_id').references(() => projects.id),
  // 프로젝트당 1명뿐인 전담 프로젝트 매니저 표시. 매니저만 recruit_agent / delegate_task 를 씁니다.
  isManager: integer('is_manager', { mode: 'boolean' }).notNull().default(false),
  // lib/agent-catalog.ts 의 직무 키. 매니저가 같은 직무를 중복 채용하지 않게 하는 기준.
  roleKey: text('role_key'),
}, (table) => [
  index('idx_agents_user_role').on(table.userId, table.role),
  index('idx_agents_user_project').on(table.userId, table.projectId),
]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), title: text('title').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  label: text('label').notNull().default('신규'), owner: text('owner').notNull().default('Nori'),
  status: text('status').notNull().default('대기'),
  // 중요도 — '높음' | '중간' | '낮음'. 마감일 대신 이 값이 우선순위를 정합니다 (lib/priority.ts).
  priority: text('priority').notNull().default('중간'),
  accent: text('accent').notNull().default('#aa2d00'), result: text('result'),
  // Asana 식 태스크 본문. 사용자가 적거나 에이전트가 채웁니다.
  description: text('description').notNull().default(''),
  // 마지막 실행의 구조화 요약 (complete_task 가 남김)
  summary: text('summary'),
  // 마지막 실행이 blocked 로 끝났을 때의 사유. 다음 실행이 성공하거나 사람이 상태를 바꾸면 NULL.
  blockedReason: text('blocked_reason'),
  // 검토 에이전트의 마지막 판정 'approve' | 'changes_requested' (lib/reviewer.ts). 발견은 상태를 바꾸지 않습니다.
  reviewVerdict: text('review_verdict'), reviewedAt: integer('reviewed_at'),
  // 매니저 카드 실행 중 위임된 카드는 그 매니저 카드를 가리킵니다 (보드의 '업무 칸' 묶음 기준). 대화 위임은 NULL.
  parentTaskId: text('parent_task_id'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_tasks_user_parent').on(table.userId, table.parentTaskId),
  index('idx_tasks_user_status').on(table.userId, table.status),
  index('idx_tasks_user_created').on(table.userId, table.createdAt),
  index('idx_tasks_user_priority').on(table.userId, table.priority),
]);

export const projectAgents = sqliteTable('project_agents', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), assignedAt: integer('assigned_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.agentId] }),
  index('idx_project_agents_user_project').on(table.userId, table.projectId),
]);

/**
 * 프로젝트에 연결된 사용자 컴퓨터의 폴더.
 * 서버(Workers)는 파일시스템에 접근할 수 없으므로 여기에는 메타데이터만 남고,
 * 실제 디렉터리 핸들은 브라우저 IndexedDB 에 있습니다 (lib/folder-access.ts).
 */
export const projectFolders = sqliteTable('project_folders', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  // 사용자가 참고용으로 적어 두는 경로 메모. 브라우저는 실제 절대경로를 알려주지 않습니다.
  pathHint: text('path_hint').notNull().default(''),
  fileCount: integer('file_count').notNull().default(0),
  addedAt: integer('added_at').notNull(),
}, (table) => [index('idx_project_folders_user_project').on(table.userId, table.projectId)]);

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }), role: text('role').notNull(),
  content: text('content').notNull(), createdAt: integer('created_at').notNull(),
  /** 스레드 = 임무 카드 id. NULL 은 스레드 없는 옛 일반 대화. */
  taskId: text('task_id'),
}, (table) => [
  index('idx_chat_user_project_agent').on(table.userId, table.projectId, table.agentId, table.createdAt),
  index('idx_chat_thread').on(table.userId, table.projectId, table.agentId, table.taskId, table.createdAt),
]);

/**
 * 대화 압축 요약 (Hermes compaction). 대화(프로젝트×에이전트)당 1행을 누적 갱신합니다.
 * covers_to 이전 메시지는 프롬프트에 원문 대신 이 요약으로 들어가고, 원문은 recall_docs(compacted=1)로 검색만 됩니다.
 */
export const chatSummaries = sqliteTable('chat_summaries', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  messageCount: integer('message_count').notNull().default(0),
  coversFrom: integer('covers_from').notNull(), coversTo: integer('covers_to').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
  /** 스레드(임무 카드 id). 일반 대화는 ''. */
  taskId: text('task_id').notNull().default(''),
}, (table) => [uniqueIndex('uq_chat_summaries_conversation').on(table.userId, table.projectId, table.agentId, table.taskId)]);

/**
 * 절차적 기억 — 스킬 (Hermes skills). "이런 일은 이렇게 한다"를 이름+설명(인덱스)+본문으로 보관합니다.
 * scope: 'global'(project_id NULL) | 'project'. 본문은 lib/skills.ts 의 use_skill 로만 프롬프트에 들어갑니다.
 */
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  scope: text('scope').notNull().default('project'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), description: text('description').notNull(), body: text('body').notNull(),
  createdBy: text('created_by').notNull(),
  uses: integer('uses').notNull().default(0),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_skills_user_scope').on(table.userId, table.scope, table.projectId)]);

/**
 * 게이트 결정 로그 (플레이북 Hook 로그). 서킷브레이커·회상 상한·위협 스캔이 막은 것과 관제 밴드 검사 결과를 남깁니다.
 * decision: 'block' | 'allow' | 'ask' | 'raise'(진단 카드 생성) | 'noop'
 */
export const gateEvents = sqliteTable('gate_events', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  gate: text('gate').notNull(), decision: text('decision').notNull(),
  projectId: text('project_id'), taskId: text('task_id'), detail: text('detail'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_gate_events_user_gate').on(table.userId, table.gate, table.createdAt)]);

/**
 * 승인 대기 큐 (물어보기형 게이트, lib/approvals.ts). 에이전트가 요청한 위험 행동을 사람이 승인해야 실행됩니다.
 * action: 'create_task'(실행당 상한 초과분) | 'save_global_skill'. payload 는 승인 시 그대로 실행할 JSON.
 */
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  action: text('action').notNull(), actor: text('actor').notNull(),
  projectId: text('project_id'), taskId: text('task_id'), runId: text('run_id'),
  summary: text('summary').notNull(), payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'), reason: text('reason'),
  createdAt: integer('created_at').notNull(), resolvedAt: integer('resolved_at'),
}, (table) => [index('idx_approvals_user_status').on(table.userId, table.status, table.createdAt)]);

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), agentName: text('agent_name').notNull(), status: text('status').notNull(),
  prompt: text('prompt').notNull(), output: text('output'), responseId: text('response_id'),
  // Hermes task_runs 를 따라 시도마다 구조화된 결과를 남깁니다.
  outcome: text('outcome'),            // 'completed' | 'blocked' | 'failed'
  summary: text('summary'),            // complete_task 가 남긴 3줄 요약
  metadata: text('metadata'),          // JSON: next_actions, blocked_reason, iterations, tool_calls
  startedAt: integer('started_at').notNull(), completedAt: integer('completed_at'),
}, (table) => [
  index('idx_agent_runs_user_task').on(table.userId, table.taskId),
  index('idx_agent_runs_user_started').on(table.userId, table.startedAt),
]);

export const usageEvents = sqliteTable('usage_events', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  kind: text('kind').notNull(), model: text('model').notNull(),
  refId: text('ref_id'), projectId: text('project_id'), agentName: text('agent_name'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  webSearchRequests: integer('web_search_requests').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_usage_user_created').on(table.userId, table.createdAt),
  index('idx_usage_user_kind').on(table.userId, table.kind),
]);

/**
 * 프로젝트 단위 커스텀 필드 정의 (Asana 의 '사용자 지정 필드').
 * 여기서 정의한 필드는 그 프로젝트에 속한 모든 태스크의 상세 UI에 나타납니다.
 * createdBy 는 'user' 이거나 필드를 만든 에이전트 이름입니다.
 */
export const projectFields = sqliteTable('project_fields', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // 'text' | 'number' | 'date' | 'select' | 'checkbox'
  type: text('type').notNull().default('text'),
  // type='select' 일 때만 의미 있는 JSON 문자열 배열
  options: text('options').notNull().default('[]'),
  // 보드 카드에 배지로 노출할지
  showOnCard: integer('show_on_card', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdBy: text('created_by').notNull().default('user'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_project_fields_user_project').on(table.userId, table.projectId, table.position),
]);

/** 태스크 × 필드 값. 값은 항상 문자열로 저장하고 type 에 맞춰 해석합니다. */
export const taskFieldValues = sqliteTable('task_field_values', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  fieldId: text('field_id').notNull().references(() => projectFields.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  value: text('value').notNull().default(''),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.fieldId] }),
  index('idx_task_field_values_user_field').on(table.userId, table.fieldId),
]);

/** 하위 작업 (체크리스트). owner 가 있으면 그 에이전트가 맡습니다. */
export const subtasks = sqliteTable('subtasks', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  owner: text('owner'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_subtasks_user_task').on(table.userId, table.taskId, table.position)]);

/** 태스크 댓글 / 진행 로그. authorKind 로 사람과 에이전트를 구분합니다. */
export const taskComments = sqliteTable('task_comments', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  author: text('author').notNull(),
  authorKind: text('author_kind').notNull().default('user'), // 'user' | 'agent'
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_task_comments_user_task').on(table.userId, table.taskId, table.createdAt)]);

/**
 * 회상 인덱스 원본 테이블. FTS5 가상 테이블(recall_fts)과 동기화 트리거는 drizzle 이 표현할 수 없어
 * drizzle/0005_recall_fts.sql 에 손으로 적었습니다. id 는 INTEGER PK 여야 FTS5 external-content 의
 * rowid 로 안전하게 쓸 수 있습니다.
 */
export const recallDocs = sqliteTable('recall_docs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  docKey: text('doc_key').notNull().unique(),      // `${kind}:${refId}`
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),                     // 'chat' | 'run' | 'task'
  refId: text('ref_id').notNull(),
  projectId: text('project_id'), agentName: text('agent_name'), role: text('role'), title: text('title'),
  content: text('content').notNull(),
  contentBigram: text('content_bigram').notNull(),  // 한글 바이그램 (lib/recall.ts koreanBigrams)
  active: integer('active').notNull().default(1),
  compacted: integer('compacted').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_recall_user_kind_created').on(table.userId, table.kind, table.createdAt),
  index('idx_recall_user_project').on(table.userId, table.projectId),
]);

/**
 * 선언적 기억 (Hermes MEMORY.md / USER.md). 문자 예산·승인 게이트·스캔은 lib/memory.ts 가 맡습니다.
 * scope: 'user'(scope_id NULL) | 'project'(project_id) | 'agent'(agent_id)
 * status: 'active' | 'pending'(에이전트가 project 스코프에 쓴 것 — 사람이 승인해야 주입됨)
 */
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  scope: text('scope').notNull(), scopeId: text('scope_id'),
  content: text('content').notNull(),
  status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_memories_user_scope').on(table.userId, table.scope, table.scopeId, table.status)]);

/**
 * 사용자 프로필 — 계정 화면에서 직접 고치는 표시 정보입니다.
 * app/auth.ts 의 getCurrentUser() 가 환경변수로 정하는 "계정"과 별개이고,
 * 겹치는 이름·이메일은 여기 값이 있으면 그것이 화면에 쓰입니다.
 * avatar 는 256px 로 줄인 data URL (lib/profile.ts AVATAR_SIZE).
 */
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name'), email: text('email'),
  company: text('company'), department: text('department'), title: text('title'),
  phone: text('phone'), bio: text('bio'), avatar: text('avatar'),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * 로그인 계정 (Google / GitHub OAuth). Claude 계정 로그인은 Anthropic 정책상 제3자 앱에서 금지라
 * 신원은 별도 제공자로 받고, Claude 는 사용자 본인의 API 키(BYOK)로 씁니다 — docs/auth-flow.md.
 * id 는 모든 테이블의 user_id 가 되므로 한 번 발급되면 바뀌지 않습니다.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),          // 'google' | 'github'
  providerId: text('provider_id').notNull(),     // 제공자가 준 고유 id (sub / GitHub id)
  email: text('email'), name: text('name'), avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull(), lastLoginAt: integer('last_login_at').notNull(),
}, (table) => [uniqueIndex('idx_users_provider').on(table.provider, table.providerId)]);

/** 서버 세션. 쿠키에는 id 만 들어가고, 로그아웃은 행 삭제로 즉시 무효화됩니다. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
  userAgent: text('user_agent'),
}, (table) => [index('idx_sessions_user').on(table.userId, table.expiresAt)]);

/**
 * 사용자별 Anthropic API 키 (BYOK). AES-GCM 으로 암호화되어 있고 마스터 키는 KEY_ENCRYPTION_SECRET.
 * key_hint 는 화면 표시용 "sk-ant-…xxxx". 자세한 것은 lib/user-keys.ts.
 */
export const userKeys = sqliteTable('user_keys', {
  userId: text('user_id').primaryKey(),
  ciphertext: text('ciphertext').notNull(), iv: text('iv').notNull(),
  keyHint: text('key_hint').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});

/**
 * 크레딧 원장 (docs/pricing-credits.md §3). 잔액을 한 칸에 두고 가감하지 않고, 모든 변동을 불변 행으로 쌓아
 * 잔액 = SUM(amount_mc) 로 구합니다. 단위는 밀리크레딧(1/1,000 크레딧 = 0.01원) 정수.
 *   kind   : trial | charge | bonus | usage | refund | adjust   (usage·refund 는 음수)
 *   bucket : paid | promo — 차감은 promo 부터. 환불 시 paid 잔액만 보면 되게 합니다.
 *   trial 은 사용자당 한 번뿐 — 부분 유니크 인덱스가 중복 지급을 막습니다.
 */
export const creditLedger = sqliteTable('credit_ledger', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  kind: text('kind').notNull(), bucket: text('bucket').notNull(),
  amountMc: integer('amount_mc').notNull(),
  refType: text('ref_type'), refId: text('ref_id'),
  meta: text('meta'),                  // JSON: 모델별 토큰, 환율·배수 스냅샷 등
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_credit_ledger_user').on(table.userId, table.createdAt),
  uniqueIndex('idx_credit_ledger_trial').on(table.userId).where(sql`kind = 'trial'`),
  uniqueIndex('idx_credit_ledger_payment').on(table.userId, table.refType, table.refId, table.kind, table.bucket).where(sql`ref_type = 'payment'`),
]);

/** 실행 중 가예약. 사용 가능 잔액 = 원장 합계 − open 상태 예약 합계. 정산되면 settled, 취소되면 released. */
export const creditHolds = sqliteTable('credit_holds', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  runId: text('run_id').notNull(),
  amountMc: integer('amount_mc').notNull(),
  status: text('status').notNull(),    // open | settled | released
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_credit_holds_run').on(table.runId),
  index('idx_credit_holds_user_status').on(table.userId, table.status),
]);

/** 결제(충전) 주문. id 가 PG 의 orderId 이고, 승인되면 원장에 charge(+bonus) 행이 붙습니다. 카드 번호는 저장하지 않습니다. */
export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(),
  provider: text('provider').notNull(),          // 'toss'
  paymentKey: text('payment_key'),
  amountKrw: integer('amount_krw').notNull(),
  creditsMc: integer('credits_mc').notNull(),
  bonusMc: integer('bonus_mc').notNull().default(0),
  status: text('status').notNull(),              // pending | done | failed | canceled | refunded
  method: text('method'), receiptUrl: text('receipt_url'),
  raw: text('raw'),                              // 승인 응답 JSON
  createdAt: integer('created_at').notNull(), approvedAt: integer('approved_at'),
}, (table) => [index('idx_payments_user').on(table.userId, table.createdAt)]);

export const transactionGuards = sqliteTable('transaction_guards', {
  id: text('id').primaryKey(), passed: integer('passed').notNull(),
}, (table) => [check('transaction_guard_passed', sql`${table.passed} = 1`)]);

export const runtimeLeases = sqliteTable('runtime_leases', {
  resourceKey: text('resource_key').primaryKey(), token: text('token').notNull(), expiresAt: integer('expires_at').notNull(),
});

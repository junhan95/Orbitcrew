/**
 * 업무 산출물 파일 (서버 보관본).
 *
 * 팀원이 save_project_file 로 만든 파일은 브라우저가 사용자 폴더에 저장하는 것과 별개로 여기(task_files)에도 남깁니다.
 *  - 매니저의 read_task_result 가 파일 전문을 읽어 QA 에게 넘길 수 있고 (서버 사슬에서는 브라우저 폴더를 볼 수 없음),
 *  - 프로젝트 상세의 '결과보기' 가 브라우저에 저장 기록이 없어도(다른 기기, 서버 사슬 실행) 파일을 열 수 있습니다.
 */
import type { FileChange } from './ai-file-changes';

export type TaskFileRow = { id: string; taskId: string; projectId: string | null; folderId: string; path: string; updatedAt: number; size: number };
export type TaskFileContent = TaskFileRow & { content: string };

export async function upsertTaskFile(db: D1Database, userId: string, params: { taskId: string; projectId: string | null } & FileChange): Promise<string> {
  const now = Date.now();
  const existing = await db.prepare('SELECT id FROM task_files WHERE user_id = ? AND task_id = ? AND path = ?').bind(userId, params.taskId, params.path).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  await db.prepare(`INSERT INTO task_files (id, user_id, task_id, project_id, folder_id, path, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, task_id, path) DO UPDATE SET folder_id = excluded.folder_id, content = excluded.content, updated_at = excluded.updated_at`)
    .bind(id, userId, params.taskId, params.projectId, params.folderId, params.path, params.content, now, now).run();
  return id;
}

export async function listTaskFiles(db: D1Database, userId: string, taskId: string): Promise<TaskFileContent[]> {
  const rows = await db.prepare('SELECT id, task_id AS taskId, project_id AS projectId, folder_id AS folderId, path, content, updated_at AS updatedAt, length(content) AS size FROM task_files WHERE user_id = ? AND task_id = ? ORDER BY updated_at DESC')
    .bind(userId, taskId).all<TaskFileContent>();
  return rows.results;
}

/** 프로젝트의 산출물 목록 (내용 제외, 최신순) */
export async function listProjectFiles(db: D1Database, userId: string, projectId: string): Promise<TaskFileRow[]> {
  const rows = await db.prepare('SELECT id, task_id AS taskId, project_id AS projectId, folder_id AS folderId, path, updated_at AS updatedAt, length(content) AS size FROM task_files WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 100')
    .bind(userId, projectId).all<TaskFileRow>();
  return rows.results;
}

export async function getTaskFile(db: D1Database, userId: string, id: string): Promise<TaskFileContent | null> {
  return db.prepare('SELECT id, task_id AS taskId, project_id AS projectId, folder_id AS folderId, path, content, updated_at AS updatedAt, length(content) AS size FROM task_files WHERE user_id = ? AND id = ?')
    .bind(userId, id).first<TaskFileContent>();
}

-- 업무 산출물 파일의 서버 보관본. 브라우저가 사용자 폴더에 저장하는 것과 별개로, 매니저·QA·'결과보기' 가 읽습니다.
CREATE TABLE task_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT,
  folder_id TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_task_files ON task_files (user_id, task_id, path);
--> statement-breakpoint
CREATE INDEX idx_task_files_project ON task_files (user_id, project_id, updated_at);

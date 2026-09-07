-- 데스크톱 Office 앱으로 바로 열기 위한 임시 파일 보관 (lib/open-files). 무작위 id 로만 접근하며 1시간 뒤 정리됩니다.
CREATE TABLE open_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_open_files_created ON open_files (created_at);

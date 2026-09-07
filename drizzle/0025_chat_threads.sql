-- 대화 스레드: 메시지를 임무(매니저 카드) 단위로 묶습니다. NULL 은 옛 '일반 대화'.
ALTER TABLE chat_messages ADD COLUMN task_id TEXT;
--> statement-breakpoint
CREATE INDEX idx_chat_thread ON chat_messages (user_id, project_id, agent_id, task_id, created_at);
--> statement-breakpoint
ALTER TABLE chat_summaries ADD COLUMN task_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
DROP INDEX IF EXISTS uq_chat_summaries_conversation;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_chat_summaries_conversation ON chat_summaries (user_id, project_id, agent_id, task_id);

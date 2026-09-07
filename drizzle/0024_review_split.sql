-- '검토' 를 '검토 중' / '검토 완료' 로 나눕니다. 검토 판정이 이미 남은 카드는 '검토 완료', 아니면 '검토 중'.
UPDATE tasks SET status = CASE WHEN review_verdict IS NOT NULL THEN '검토 완료' ELSE '검토 중' END WHERE status = '검토';

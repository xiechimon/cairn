ALTER TABLE `todo` ADD `correctionRequired` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE todo SET correctionRequired = 1
WHERE EXISTS (
  SELECT 1 FROM todo_tag
  JOIN tag ON tag.id = todo_tag.tagId
  WHERE todo_tag.todoId = todo.id AND lower(tag.name) = 'correction'
);
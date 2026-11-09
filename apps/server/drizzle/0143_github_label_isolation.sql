CREATE TABLE `github_label` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`createdAt` integer DEFAULT 0 NOT NULL,
	`v` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `todo_github_label` (
	`todoId` text NOT NULL,
	`labelId` text NOT NULL,
	PRIMARY KEY(`todoId`, `labelId`),
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `github_label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `_github_label_provenance_guard` (`valid` integer NOT NULL CHECK (`valid` = 1));
--> statement-breakpoint
INSERT INTO `_github_label_provenance_guard`
SELECT NOT EXISTS (
  SELECT 1 FROM tag LEFT JOIN project ON project.id = tag.projectId WHERE project.id IS NULL
) AND NOT EXISTS (
  SELECT 1 FROM todo_tag
  LEFT JOIN tag ON tag.id = todo_tag.tagId
  LEFT JOIN todo ON todo.id = todo_tag.todoId
  WHERE tag.id IS NULL OR todo.id IS NULL
);
--> statement-breakpoint
INSERT INTO github_label (id, projectId, name, color, createdAt, v)
SELECT id, projectId, name, color, createdAt, v FROM tag
WHERE projectId IN (SELECT id FROM project WHERE repoKind = 'github')
   OR EXISTS (
     SELECT 1 FROM todo_tag JOIN todo ON todo.id = todo_tag.todoId
     WHERE todo_tag.tagId = tag.id AND todo.sourceKind IN ('github-issue', 'github-issue-self')
   );
--> statement-breakpoint
INSERT INTO todo_github_label (todoId, labelId)
SELECT todo_tag.todoId, todo_tag.tagId FROM todo_tag
JOIN tag ON tag.id = todo_tag.tagId
JOIN project ON project.id = tag.projectId
JOIN todo ON todo.id = todo_tag.todoId
WHERE project.repoKind = 'github' OR todo.sourceKind IN ('github-issue', 'github-issue-self');
--> statement-breakpoint
DELETE FROM todo_tag WHERE EXISTS (
  SELECT 1 FROM todo_github_label
  WHERE todo_github_label.todoId = todo_tag.todoId AND todo_github_label.labelId = todo_tag.tagId
);
--> statement-breakpoint
DROP TABLE `_github_label_provenance_guard`;

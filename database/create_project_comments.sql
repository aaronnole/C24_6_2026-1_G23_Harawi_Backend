-- Tabla de comentarios por proyecto
CREATE TABLE IF NOT EXISTS project_comments (
  comment_id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE
);

-- Evitar comentarios vacios
ALTER TABLE project_comments
  ADD CONSTRAINT project_comments_content_not_empty
  CHECK (length(trim(content)) > 0);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_project_comments_project_id_created_at
  ON project_comments(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_comments_user_id
  ON project_comments(user_id);

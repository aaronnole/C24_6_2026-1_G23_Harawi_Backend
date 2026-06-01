-- Relación de seguimiento entre usuarios (muchos a muchos)
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  following_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT user_follows_no_self_follow CHECK (follower_id <> following_id)
);

-- Índices para consultas de seguidores/seguidos
CREATE INDEX IF NOT EXISTS idx_user_follows_following_id
  ON user_follows(following_id);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id
  ON user_follows(follower_id);

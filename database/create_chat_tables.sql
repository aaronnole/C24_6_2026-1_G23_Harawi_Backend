-- Conversaciones de chat entre usuarios
CREATE TABLE IF NOT EXISTS chat_conversations (
  conversation_id SERIAL PRIMARY KEY,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Participantes por conversación (permite chats de 2+ usuarios)
CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id INT NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Mensajes
CREATE TABLE IF NOT EXISTS chat_messages (
  message_id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
  sender_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Validar contenido no vacío
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_content_not_empty
  CHECK (length(trim(content)) > 0);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id
  ON chat_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON chat_messages(conversation_id, created_at DESC);

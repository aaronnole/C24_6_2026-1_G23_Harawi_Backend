-- Tabla para almacenar metadatos de archivos
CREATE TABLE IF NOT EXISTS files (
    file_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL UNIQUE,
    mimetype VARCHAR(100),
    size INTEGER,
    url TEXT NOT NULL,
    storage_type VARCHAR(20) DEFAULT 'local', -- 'local' o 's3'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

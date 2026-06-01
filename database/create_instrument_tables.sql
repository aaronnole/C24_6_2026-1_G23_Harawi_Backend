CREATE TABLE instrument (
    instrument_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE user_instrument (
    user_instrument_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    instrument_id INTEGER REFERENCES instrument(instrument_id) ON DELETE CASCADE,
    UNIQUE(user_id, instrument_id) -- Para evitar que un usuario tenga el mismo instrumento repetido
);

-- (Opcional) Insertar algunos instrumentos básicos por defecto
INSERT INTO instrument (name) VALUES 
('Guitarra'),
('Bajo'),
('Teclado'),
('Voz/Cantante'),
('Composicion'),
('Percusión')
ON CONFLICT DO NOTHING;

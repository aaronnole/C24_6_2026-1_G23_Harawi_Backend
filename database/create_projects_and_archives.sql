-- Nuevas tablas de referencia
CREATE TABLE IF NOT EXISTS genres (
    genre_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    tag_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

-- Modificaciones a la tabla projects (ya existente)
ALTER TABLE projects
    DROP COLUMN IF EXISTS state,
    ADD COLUMN IF NOT EXISTS genre_id INT,
    ADD COLUMN IF NOT EXISTS tag_id INT;

ALTER TABLE projects
    ADD CONSTRAINT fk_project_genre
        FOREIGN KEY (genre_id)
        REFERENCES genres(genre_id)
        ON DELETE SET NULL;

ALTER TABLE projects
    ADD CONSTRAINT fk_project_tag
        FOREIGN KEY (tag_id)
        REFERENCES tags(tag_id)
        ON DELETE SET NULL;

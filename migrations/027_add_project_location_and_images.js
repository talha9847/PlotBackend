async function up(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Add project location columns if they don't exist
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7),
      ADD COLUMN IF NOT EXISTS google_map_url TEXT;

    -- Validate coordinates when provided
    ALTER TABLE projects
      ADD CONSTRAINT chk_projects_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
      ADD CONSTRAINT chk_projects_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

    -- Store multiple images for each project
    CREATE TABLE IF NOT EXISTS project_images (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

      project_id BIGINT NOT NULL
        REFERENCES projects(id) ON DELETE RESTRICT,

      image_url TEXT NOT NULL,
      alt_text VARCHAR(255),
      is_cover BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0
        CHECK (sort_order >= 0),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_project_images_project_id
      ON project_images (project_id);

    -- At most one cover image per project
    CREATE UNIQUE INDEX IF NOT EXISTS uq_project_images_cover
      ON project_images (project_id)
      WHERE is_cover = TRUE;
  `);
}

module.exports = { up };

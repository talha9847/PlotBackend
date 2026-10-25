async function up(client) {
  await client.query(`
    ALTER TABLE plots
      ADD COLUMN IF NOT EXISTS facing VARCHAR(20)
        CHECK (
          facing IS NULL
          OR facing IN (
            'north',
            'south',
            'east',
            'west',
            'north_east',
            'north_west',
            'south_east',
            'south_west'
          )
        ),

      ADD COLUMN IF NOT EXISTS is_corner BOOLEAN NOT NULL DEFAULT FALSE,

      ADD COLUMN IF NOT EXISTS boundary_wall BOOLEAN NOT NULL DEFAULT FALSE,

      ADD COLUMN IF NOT EXISTS road_width NUMERIC(8,2)
        CHECK (road_width IS NULL OR road_width >= 0);

    -- road_width is expressed in the same unit as plots.dimension.

    CREATE INDEX IF NOT EXISTS idx_plots_facing
      ON plots (facing)
      WHERE deleted_at IS NULL;
  `);
}

module.exports = { up };

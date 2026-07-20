-- 007_pit_loss.sql — measured pit-loss per race, for public track/type averages.
--
-- Trust model: pit_lane_time_ms / stationary_ms are measured telemetry (F1 UDP
-- LapData packet), not client-derived guesses. Stored one row per race (beside
-- races like race_setup/race_detail) and aggregated (avg) by track + game_format.
-- Stop type (tyres-only vs wing) is NOT stored — it is classified at query time
-- from stationary_ms thresholds, so the policy can evolve without a migration.
CREATE TABLE platform.race_pit_loss (
    race_id          UUID PRIMARY KEY REFERENCES platform.races(id) ON DELETE CASCADE,
    stops            INTEGER NOT NULL DEFAULT 0,
    pit_lane_time_ms INTEGER NOT NULL,       -- lane dwell (travel + stationary), measured
    stationary_ms    INTEGER NOT NULL DEFAULT 0, -- box work time, stop-type classifier input
    CONSTRAINT race_pit_loss_lane_chk  CHECK (pit_lane_time_ms BETWEEN 1 AND 600000),
    CONSTRAINT race_pit_loss_stat_chk  CHECK (stationary_ms   BETWEEN 0 AND 600000),
    CONSTRAINT race_pit_loss_stops_chk CHECK (stops           BETWEEN 0 AND 100),
    -- stationary (box work) is a subset of lane dwell — physically always ≤.
    CONSTRAINT race_pit_loss_cross_chk CHECK (stationary_ms <= pit_lane_time_ms)
);

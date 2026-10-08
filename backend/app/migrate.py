"""Bring an existing SQLite file up to the current models.

create_all() makes missing tables but never touches existing ones, so columns added
after the first deploy are added here. Every step is idempotent and only adds things.
TODO: switch to Alembic if the schema needs anything beyond added nullable columns.
"""

from sqlalchemy import Engine, inspect, text

# record_sets columns added after the first release: name -> SQLite column definition
RECORD_SET_COLUMNS = {
    "failover": "VARCHAR(16)",
    "region": "VARCHAR(32)",
    "geo_location": "VARCHAR(64)",
    "geoproximity": "VARCHAR(64)",
    "bias": "INTEGER",
    "cidr_collection_id": "VARCHAR(36)",
    "cidr_location": "VARCHAR(16)",
    "health_check_id": "VARCHAR(36)",
    "alias_target_type": "VARCHAR(32)",
    "alias_target": "VARCHAR(255)",
    "alias_region": "VARCHAR(32)",
    "evaluate_target_health": "BOOLEAN DEFAULT 0",
}


def upgrade(engine: Engine) -> None:
    existing = {c["name"] for c in inspect(engine).get_columns("record_sets")}
    with engine.begin() as conn:
        for name, ddl in RECORD_SET_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE record_sets ADD COLUMN {name} {ddl}"))

        # Private zones created before multi-VPC support kept their one VPC on the zone row.
        conn.execute(
            text(
                """
                INSERT INTO zone_vpcs (hosted_zone_id, region, vpc_id)
                SELECT z.id, z.vpc_region, z.vpc_id FROM hosted_zones z
                WHERE z.zone_type = 'private' AND z.vpc_id IS NOT NULL AND z.vpc_region IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM zone_vpcs v WHERE v.hosted_zone_id = z.id)
                """
            )
        )

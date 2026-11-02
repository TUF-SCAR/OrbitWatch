"""Explicit account-only production activation; never imported by startup.

Default is read-only inspection. --apply --expected-target FINGERPRINT applies
002–004 as one transaction to the configured Supabase project only. No row data
is seeded. Failed validation rolls back the additive DDL; recovery leaves code
disabled/reverted while new empty tables may safely remain.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from core.config import required

TABLES=("account_observation_locations","account_notification_preferences","account_alert_subscriptions","account_notification_inbox","account_push_devices","notification_runner_state","account_notification_delivery")
LEGACY=("users","satellite_orbit_data","satellite_orbit_history","satellite_historical_elements")
NORMAL_CEILING=300_000_000
ABSOLUTE_CEILING=400_000_000


def run(apply=False, expected=None):
    url=make_url(required("DATABASE_URL"))
    if url.get_backend_name()!="postgresql" or not url.host or not url.host.endswith((".supabase.com",".supabase.co")):
        raise RuntimeError("Configured target must be the existing Supabase PostgreSQL project")
    fingerprint=sha256(f"{url.host}|{url.username}|{url.database}".encode()).hexdigest()[:16]
    if apply and expected!=fingerprint:
        raise RuntimeError("Target fingerprint does not match reviewed project")
    engine=create_engine(url,hide_parameters=True,connect_args={"connect_timeout":5,"options":"-c statement_timeout=30000 -c lock_timeout=5000"})
    def snapshot(connection):
        size=connection.scalar(text("SELECT pg_database_size(current_database())"))
        relations=[dict(row) for row in connection.execute(text("SELECT relname AS name,pg_table_size(oid) AS table_bytes,pg_indexes_size(oid) AS index_bytes FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname")).mappings()]
        counts={name:connection.scalar(text(f"SELECT count(*) FROM public.{name}")) for name in LEGACY}
        account_counts={name:connection.scalar(text(f"SELECT count(*) FROM public.{name}")) for name in TABLES if connection.scalar(text('SELECT to_regclass(:name)'),{'name':'public.'+name})}
        return {"database_bytes":size,"remaining_nominal_bytes":500_000_000-size,"relations":relations,"legacy_counts":counts,"account_counts":account_counts}
    with engine.begin() as connection:
        if not apply:
            connection.execute(text("SET TRANSACTION READ ONLY"))
        else:
            connection.execute(text("SELECT pg_advisory_xact_lock(68270605)"))
        inspector=inspect(connection)
        if not set(LEGACY).issubset(inspector.get_table_names(schema="public")):
            raise RuntimeError("Configured database does not match OrbitWatch's existing schema")
        before=snapshot(connection)
        if before["database_bytes"]>=NORMAL_CEILING-1_000_000:
            raise RuntimeError("Normal database reserve would be at risk; migration not applied")
        from models.user import User
        from models.account import ObservationLocation, NotificationPreferences
        from models.alerts import AlertSubscription, InboxNotification
        from models.notification_delivery import PushDevice,NotificationRun,NotificationDelivery
        models=(ObservationLocation,NotificationPreferences,AlertSubscription,InboxNotification,PushDevice,NotificationRun,NotificationDelivery)
        def compatible():
            for model in models:
                name=model.__tablename__
                if inspector.has_table(name,schema="public"):
                    actual={column["name"]:column for column in inspector.get_columns(name,schema="public")}
                    if not set(model.__table__.columns.keys()).issubset(actual):
                        raise RuntimeError("Existing account schema requires reviewed additive repair")
                    for column in model.__table__.columns:
                        if actual[column.name]["type"]._type_affinity is not column.type._type_affinity:
                            raise RuntimeError("Existing account column type is incompatible")
        compatible()
        def delivery_constraints():
            for model in (PushDevice,NotificationRun,NotificationDelivery):
                name=model.__tablename__
                if not inspector.has_table(name,schema='public'):continue
                expected={constraint.name for constraint in model.__table__.constraints if constraint.name}
                actual={constraint['name'] for constraint in inspector.get_check_constraints(name,schema='public')+inspector.get_unique_constraints(name,schema='public')}
                if not expected.issubset(actual):raise RuntimeError('Delivery constraints require reviewed additive repair')
                indexes={index['name'] for index in inspector.get_indexes(name,schema='public')}
                if not {index.name for index in model.__table__.indexes}.issubset(indexes):raise RuntimeError('Delivery indexes are incomplete')
        delivery_constraints()
        if apply:
            for filename in ("002_account_notification_foundation.sql","003_account_alert_subscriptions.sql","004_account_notification_inbox.sql","005_notification_delivery.sql"):
                sql=(Path(__file__).parent/"migrations"/filename).read_text(encoding="utf-8")
                if re.search(r"(?im)^\s*(DROP|TRUNCATE|DELETE|INSERT|UPDATE)\b",sql):
                    raise RuntimeError("Only reviewed additive schema statements are allowed")
                sql=re.sub(r"(?m)^BEGIN;\s*$|^COMMIT;\s*$","",sql)
                connection.exec_driver_sql(sql)
            inspector.clear_cache();compatible();delivery_constraints()
            for name in TABLES:
                if not connection.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(:table)"),{"table":"public."+name}):
                    raise RuntimeError("Private account table is missing RLS")
            after=snapshot(connection)
            if after["database_bytes"]>=NORMAL_CEILING or after["database_bytes"]>=ABSOLUTE_CEILING:
                raise RuntimeError("Storage ceiling reached; additive transaction rolled back")
            if before["legacy_counts"]!=after["legacy_counts"]:
                raise RuntimeError("Legacy row counts changed during migration; transaction rolled back")
            if any(after['account_counts'].get(name)!=count for name,count in before['account_counts'].items()):
                raise RuntimeError('Existing account row counts changed; transaction rolled back')
        else:
            after=before
        result={"target_fingerprint":fingerprint,"applied":apply,"before":before,"after":after,"account_tables_present":[name for name in TABLES if inspector.has_table(name,schema="public")]}
    if apply:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            result["after"]=snapshot(connection)
    engine.dispose()
    print(json.dumps(result,indent=2))
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true");parser.add_argument("--expected-target");args=parser.parse_args()
    try:run(args.apply,args.expected_target)
    except Exception as error:
        print("Account activation failed safely:",str(error) if isinstance(error,RuntimeError) else type(error).__name__);sys.exit(1)

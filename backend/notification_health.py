"""Read-only scheduler/schema/key health; no notifications or source requests."""
from datetime import datetime,timezone
import argparse,json
from sqlalchemy import text
from core.database import database_engine
from services.account_inbox import utc
from services.browser_push import configuration

def health():
    with database_engine.connect() as db:
        db.execute(text('SET TRANSACTION READ ONLY'))
        for table in ('account_viewing_opportunities','visibility_plan_cache'):
            db.execute(text(f'SELECT 1 FROM {table} LIMIT 0'))
        db.execute(text('SELECT alert_stage,opportunity_id,details FROM account_notification_delivery LIMIT 0'))
        row=db.execute(text('SELECT last_success_at,last_planned_at,last_error,mode,evaluated,generated FROM notification_runner_state WHERE id=1')).mappings().first()
        size=db.scalar(text('SELECT pg_database_size(current_database())'))
        count=db.scalar(text("SELECT count(*) FROM account_viewing_opportunities WHERE status='scheduled' AND end_at>now()"))
    last=utc(row['last_success_at']) if row else None
    age=(datetime.now(timezone.utc)-last).total_seconds() if last else None
    return {'state':'healthy' if row and row['mode']=='loop' and age is not None and 0<=age<120 and not row['last_error'] else 'not_operational',
            'last_success_at':last.isoformat() if last else None,'heartbeat_age_seconds':round(age,1) if age is not None else None,
            'last_planned_at':str(row['last_planned_at']) if row else None,'last_error':row['last_error'] if row else None,
            'evaluated':row['evaluated'] if row else 0,'generated':row['generated'] if row else 0,'scheduled_opportunities':count,
            'push_configured':bool(configuration()),'database_bytes':size,'remaining_nominal_bytes':500000000-size}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--require-worker',action='store_true');parser.add_argument('--require-push',action='store_true');args=parser.parse_args()
    try:
        result=health();print(json.dumps(result))
        if args.require_worker and result['state']!='healthy' or args.require_push and not result['push_configured']:raise SystemExit(1)
    except Exception as error:print(json.dumps({'state':'unavailable','error_type':type(error).__name__}));raise SystemExit(1)

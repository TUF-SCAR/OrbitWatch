"""One explicit, bounded shared-cache refresh; never changes account data."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import time
from services import natural_events as n


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--refresh',action='store_true');args=parser.parse_args()
    before={};started=time.time()
    for p,s in n.stores.items():
        with s.db() as db:before[p]=db.execute('SELECT count(*) FROM calls WHERE provider=?',(p,)).fetchone()[0]
    outcomes={}
    if args.refresh:
        n.database_availability.ensure()
        def run(p):
            try:n.refresh(p);return p,'completed'
            except Exception as error:return p,type(error).__name__
        with ThreadPoolExecutor(max_workers=3) as pool:outcomes=dict(pool.map(run,n.stores))
    result=n.current_events(schedule=False);report={'state':result['state'],'outcomes':outcomes,'coverage':result.get('coverage'),'providers':{}}
    for p,s in n.stores.items():
        with s.db() as db:calls=db.execute('SELECT count(*) FROM calls WHERE provider=? AND stamp>=?',(p,started)).fetchone()[0]
        report['providers'][p]={**result['providers'][p],'requests_this_run':calls}
    report['tracks']=[{'id':e['id'],'title':e['title'],'observed':len(e['track']['observed']),'forecast':len(e['track']['forecast']),'latest':e['reported_at']} for e in result['events'] if e.get('track')]
    report['categories']={c:sum(e['category']==c for e in result['events']) for c in sorted({e['category'] for e in result['events']})}
    report['cache_bytes']=sum(f.stat().st_size for f in n.root.rglob('*') if f.is_file())
    if args.refresh:n.root.joinpath('batch10.audit.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report,indent=2));n.shutdown()


if __name__=='__main__':main()

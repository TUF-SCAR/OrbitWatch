"""Independent worker: python backend/run_notifications.py --once (or --loop).

Deploy --loop under an always-on supervisor on the SAME persistent ingestion host
and shared cache volume. No web-server lifespan dependency or browser dependency.
Set ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS=true only there, with an explicit
ORBITWATCH_NOTIFICATION_HOST_ID. Default consumes existing cached sources only.
VAPID keys + ORBITWATCH_PUSH_ENCRYPTION_KEY are server environment secrets.
"""
import argparse
import json
import signal
import threading
import sys
from services.notification_runner import run_once,provider_host_fingerprint


def main():
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--once',action='store_true');mode.add_argument('--loop',action='store_true')
    mode.add_argument('--host-fingerprint',action='store_true',help='Print the current host/cache fingerprint for explicit single-ingestion-host setup')
    args=parser.parse_args();stop=threading.Event()
    if args.host_fingerprint:print(provider_host_fingerprint());return
    def halt(*_):stop.set();raise KeyboardInterrupt()
    signal.signal(signal.SIGINT,halt);signal.signal(signal.SIGTERM,halt)
    while not stop.is_set():
        try:print(json.dumps(run_once(mode='loop' if args.loop else 'once')),flush=True)
        except KeyboardInterrupt:break
        except Exception:
            print(json.dumps({'state':'failed','reason':'Source/database unavailable; next scheduled run may retry'}),flush=True)
            if args.once:sys.exit(1)
        if not args.loop:break
        stop.wait(10) # Due dispatch every10s; expensive planning remains five-minute.


if __name__=='__main__':main()

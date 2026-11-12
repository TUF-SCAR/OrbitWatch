"""Linux deploy integration with fake git/systemd/Python/curl, no real services.

python3 tests/check_notification_deploy.py [path/to/orbitwatch-deploy.sh]
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json,os,shlex,subprocess,sys
SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'deploy/orbitwatch-deploy.sh'
script=SOURCE.read_text();old='a'*40;target='b'*40
stub='''#!/usr/bin/env python3
import os,sys,json,subprocess,shutil
from pathlib import Path
root=Path(os.environ['QA_ROOT']);args=sys.argv[1:];name=Path(sys.argv[0]).name
with (root/'calls').open('a') as log:log.write(name+' '+str(args)+'\\n')
head=root/'head'
if name=='git':
    args=args[2:]
    if args[0]=='rev-parse':print('b'*40 if args[1]=='origin/main' else head.read_text())
    elif args[0]=='reset':head.write_text(args[2])
    elif args[0]=='diff':sys.exit(0 if any('requirements' in arg for arg in args) else 1)
elif name=='runuser':sys.exit(subprocess.call(args[4:] if args[:4]==['-u','ubuntu','--','bash'] else args[3:]))
elif name=='systemctl':
    if args[0]=='is-active' or args[0]=='is-enabled':sys.exit(0)
elif name=='python':
    if 'notification_health.py' in ' '.join(args) and os.environ.get('QA_FAIL')=='worker' and head.read_text()=='b'*40:sys.exit(1)
elif name=='curl':
    if os.environ.get('QA_FAIL')=='api' and head.read_text()=='b'*40:sys.exit(1)
elif name=='install':shutil.copyfile(args[-2],args[-1])
'''
# runuser must preserve `bash -c`; the wrapper never invokes real runuser/sudo.
stub=stub.replace("args[4:] if args[:4]==['-u','ubuntu','--','bash'] else args[3:]","args[3:]")
for fail in ('','worker','api'):
    with TemporaryDirectory(prefix='orbitwatch-deploy-isolated-') as directory:
        root=Path(directory);app=root/'app';bin=root/'bin';units=root/'units'
        (app/'.venv/bin').mkdir(parents=True);(app/'backend').mkdir();(app/'deploy').mkdir();bin.mkdir();units.mkdir()
        (app/'backend/.env').write_text('ISOLATED_FIXTURE=1\n');(app/'deploy/orbitwatch-notifications.service').write_text('NEW FIXTURE UNIT')
        (units/'orbitwatch-notifications.service').write_text('ORIGINAL FIXTURE UNIT');(root/'head').write_text(old)
        for name in ('git','runuser','systemctl','curl','install','python'):
            path=bin/name;path.write_text(stub);path.chmod(0o755)
        (app/'.venv/bin/python').symlink_to(bin/'python')
        for name,body in [('sleep','exit 0'),('flock','exit 0')]:
            path=bin/name;path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o755)
        isolated=script.replace('APP=/home/ubuntu/OrbitWatch','APP='+shlex.quote(str(app))).replace('/etc/systemd/system',str(units)).replace('/run/lock/orbitwatch-deploy.lock',str(root/'lock'))
        path=root/'deploy.sh';path.write_text(isolated)
        env={**os.environ,'QA_ROOT':str(root),'QA_FAIL':fail,'PATH':str(bin)+':'+os.environ['PATH']}
        run=subprocess.run(['bash',str(path),target,'false'],env=env,text=True,capture_output=True,timeout=25)
        calls=(root/'calls').read_text()
        assert "systemctl ['stop', 'orbitwatch-notifications']" in calls
        if fail:
            assert run.returncode!=0,(fail,run.stdout,run.stderr)
            assert (root/'head').read_text()==old
            assert (units/'orbitwatch-notifications.service').read_text()=='ORIGINAL FIXTURE UNIT'
            assert calls.count("systemctl ['restart', 'orbitwatch-notifications']")>=1
        else:
            assert run.returncode==0,(run.stdout,run.stderr)
            assert (root/'head').read_text()==target
            assert 'apply_account_migrations.py --apply --expected-target' in calls
            assert 'notification_health.py --require-worker --require-push' in calls
            assert "systemctl ['restart', 'orbitwatch-notifications']" in calls
print('PASS actual deploy script: API+worker install/restart/admission; failed API and failed worker restore prior code/service; all git/systemd/network/database mocked')

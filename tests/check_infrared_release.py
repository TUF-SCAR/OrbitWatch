"""Environment preservation and exact deployment payload, entirely disposable."""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat
from tempfile import TemporaryDirectory
import zlib

ROOT=Path(__file__).resolve().parents[1]


def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


configure=module('infrared_configuration',ROOT/'backend/configure_infrared.py').configure
parameters=module('infrared_deployment',ROOT/'deploy/ssm_parameters.py').parameters
checks=0
with TemporaryDirectory() as directory:
    path=Path(directory)/'.env'
    preserved='JWT_SECRET_KEY=isolated-fixture-only\nDATABASE_URL=isolated-value\n# Preserve provider comments\nOTHER_PROVIDER=value\n'
    path.write_text(preserved+'ORBITWATCH_INFRARED_ENABLED=false\nORBITWATCH_INFRARED_LICENSE_CONFIRMED=false\n',encoding='utf-8')
    if os.name!='nt':path.chmod(0o600)
    configure(path)
    value=path.read_text(encoding='utf-8')
    assert value.startswith(preserved);checks+=1
    assert 'ORBITWATCH_INFRARED_ENABLED=true\n' in value and 'ORBITWATCH_INFRARED_LICENSE_CONFIRMED=true\n' in value;checks+=1
    assert 'ORBITWATCH_INFRARED_LICENSE_TICKET=EUMHD-19074\n' in value;checks+=1
    configure(path);assert path.read_text(encoding='utf-8')==value;checks+=1
    disabled=value.replace('ORBITWATCH_INFRARED_ENABLED=true','ORBITWATCH_INFRARED_ENABLED=false')
    path.write_text(disabled,encoding='utf-8');configure(path)
    assert path.read_text(encoding='utf-8')==disabled;checks+=1
    if os.name!='nt':assert stat.S_IMODE(path.stat().st_mode)==0o600
    checks+=1
    try:configure(Path(directory)/'missing')
    except RuntimeError:pass
    else:raise AssertionError('Missing environment must not be invented')
    checks+=1
    assert not list(Path(directory).glob('.infrared-env-*'));checks+=1

helper=(ROOT/'deploy/orbitwatch-deploy.sh').read_bytes()
payload=parameters('a'*40,'false',helper)
command=payload['commands'][0]
encoded=re.search(r"base64.b64decode\('([A-Za-z0-9+/=]+)'\)",command).group(1)
assert zlib.decompress(base64.b64decode(encoded))==helper;checks+=1
assert hashlib.sha256(helper).hexdigest() in command and 'sha256sum -c' in command;checks+=1
assert 'bash -n "$staged"' in command and 'mv -fT "$staged" "$active"' in command;checks+=1
assert 'root:root:755' in command and 'before-'+'a'*40 in command;checks+=1
assert len(command)<24000 and payload['executionTimeout']==['1200'];checks+=1
assert command.endswith('exec "$active" '+'a'*40+' false');checks+=1
for sha,requirements in [('a'*39,'false'),('a'*40,'false; echo injected')]:
    try:parameters(sha,requirements,helper)
    except ValueError:pass
    else:raise AssertionError('Untrusted deployment arguments allowed')
    checks+=1
print(f'PASS: {checks} environment-preservation, operator-disable and exact-helper payload checks')

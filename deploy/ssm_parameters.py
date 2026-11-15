"""Ship the reviewed exact-commit deployment helper through existing AWS SSM."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import zlib


def parameters(sha,requirements,helper):
    if not re.fullmatch('[0-9a-f]{40}',sha) or requirements not in {'true','false'}:
        raise ValueError('Invalid deployment arguments')
    digest=hashlib.sha256(helper).hexdigest()
    payload=base64.b64encode(zlib.compress(helper)).decode('ascii')
    # No environment/credentials are embedded. SSM receives only reviewed code.
    command=f'''set -eu
exec 8>/run/lock/orbitwatch-deploy-bootstrap.lock
flock 8
active=/usr/local/sbin/orbitwatch-deploy
test -f "$active" && test ! -L "$active"
test "$(stat -c '%U:%G:%a' "$active")" = root:root:755
installed=$(sha256sum "$active" | cut -d' ' -f1)
echo "Installed deployment helper: $installed; reviewed helper: {digest}"
if [ "$installed" != '{digest}' ]; then
  staged=$(mktemp /usr/local/sbin/.orbitwatch-deploy.XXXXXXXX)
  trap 'rm -f "$staged"' EXIT
  /usr/bin/python3 -c "import base64,zlib,sys;sys.stdout.buffer.write(zlib.decompress(base64.b64decode('{payload}')))" > "$staged"
  echo '{digest}  '"$staged" | sha256sum -c -
  bash -n "$staged"
  backup="$active.before-{sha}"
  if [ ! -e "$backup" ]; then cp -p "$active" "$backup"; fi
  chown root:root "$staged"
  chmod 755 "$staged"
  mv -fT "$staged" "$active"
  trap - EXIT
fi
sha256sum "$active"
exec "$active" {sha} {requirements}'''
    return {'commands':[command],'executionTimeout':['1200']}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('sha');parser.add_argument('requirements',choices=['true','false'])
    args=parser.parse_args()
    helper=Path(__file__).with_name('orbitwatch-deploy.sh').read_bytes()
    print(json.dumps(parameters(args.sha,args.requirements,helper)))

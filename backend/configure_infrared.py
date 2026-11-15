"""Activate the exact CC BY 4.0 layer confirmed in EUMHD-19074, preserving secrets."""
import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


def configure(path):
    path=Path(path)
    if path.is_symlink() or not path.is_file(): raise RuntimeError('Expected an existing regular backend environment file')
    before=path.stat()
    content=path.read_text(encoding='utf-8')
    marker='ORBITWATCH_INFRARED_LICENSE_TICKET=EUMHD-19074'
    # A later operator disable remains authoritative on subsequent releases.
    if marker in content.splitlines():
        print('Infrared licensing already configured; preserving current operator gates')
        return
    for key in ('ORBITWATCH_INFRARED_ENABLED','ORBITWATCH_INFRARED_LICENSE_CONFIRMED'):
        pattern=rf'(?m)^\s*(?:export\s+)?{key}\s*=.*$'
        if re.search(pattern,content): content=re.sub(pattern,f'{key}=true',content)
        else: content=content.rstrip('\r\n')+f'\n{key}=true\n'
    content=content.rstrip('\r\n')+'\n'+marker+'\n'
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,prefix='.infrared-env-',delete=False) as handle:
            temporary=Path(handle.name)
            if os.name!='nt': os.fchmod(handle.fileno(),stat.S_IMODE(before.st_mode))
            handle.write(content);handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
    finally:
        if temporary: temporary.unlink(missing_ok=True)
    print('Activated licensed mumi:worldcloudmap_ir108 only; EUMHD-19074 / CC BY 4.0; existing environment preserved')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--activate-confirmed-layer',action='store_true',required=True)
    parser.parse_args()
    configure(Path(__file__).resolve().parent/'.env')

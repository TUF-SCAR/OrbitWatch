"""Sensitive endpoints remain encrypted. Only recognized public push services."""
import base64
import hashlib
import ipaddress
import json
import os
import re
import socket
from urllib.parse import urlsplit
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

EXACT_HOSTS={'fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'}


def device_limit():
    try:return max(1,min(5,int(os.getenv('ORBITWATCH_PUSH_DEVICE_LIMIT','5'))))
    except ValueError:return 5


def configuration():
    names=('ORBITWATCH_VAPID_PRIVATE_KEY','ORBITWATCH_VAPID_PUBLIC_KEY','ORBITWATCH_VAPID_SUBJECT','ORBITWATCH_PUSH_ENCRYPTION_KEY')
    values={name:os.getenv(name,'').strip() for name in names}
    try:
        Fernet(values[names[3]].encode())
        public=decode(values[names[1]])
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),public)
        private=serialization.load_der_private_key(decode(values[names[0]]),password=None)
        if not isinstance(private,ec.EllipticCurvePrivateKey) or not isinstance(private.curve,ec.SECP256R1):return None
        if private.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)!=public:return None
        if not values[names[2]].startswith(('mailto:','https://')):return None
    except (ValueError,TypeError):return None
    return values


def decode(value):return base64.urlsafe_b64decode(value+'='*(-len(value)%4))


def validate_subscription(value,resolve=False):
    if not isinstance(value,dict) or set(value)-{'endpoint','keys','expirationTime'}:raise ValueError('Invalid push subscription')
    endpoint=value.get('endpoint','');keys=value.get('keys',{})
    if not isinstance(endpoint,str) or len(endpoint)>2048 or any(ord(c)<33 for c in endpoint):raise ValueError('Invalid push endpoint')
    url=urlsplit(endpoint);host=url.hostname or ''
    if url.scheme!='https' or url.username or url.password or url.port not in (None,443) or url.fragment or not url.path or url.path=='/':raise ValueError('Invalid push endpoint')
    if host not in EXACT_HOSTS and not re.fullmatch(r'[a-z0-9-]+\.notify\.windows\.com',host):raise ValueError('Unsupported push service')
    if resolve:
        addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):raise ValueError('Push service address is not public')
    if not isinstance(keys,dict) or set(keys)!={'p256dh','auth'} or any(not isinstance(keys.get(key),str) or len(keys[key])>128 for key in ('p256dh','auth')):raise ValueError('Invalid push keys')
    if any(not re.fullmatch(r'[A-Za-z0-9_-]+={0,2}',keys[key]) for key in keys):raise ValueError('Invalid push key encoding')
    try:
        if len(decode(keys['auth']))!=16:raise ValueError()
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),decode(keys['p256dh']))
    except (ValueError,TypeError):raise ValueError('Invalid push encryption keys') from None
    return {'endpoint':endpoint,'keys':keys}


def endpoint_hash(value):return hashlib.sha256(value['endpoint'].encode()).hexdigest()


def encrypt_subscription(value):
    config=configuration()
    if not config:raise ValueError('Browser push not configured')
    return Fernet(config['ORBITWATCH_PUSH_ENCRYPTION_KEY'].encode()).encrypt(json.dumps(value,separators=(',',':')).encode()).decode()


def decrypt_subscription(value):
    config=configuration()
    if not config:raise ValueError('Browser push not configured')
    return validate_subscription(json.loads(Fernet(config['ORBITWATCH_PUSH_ENCRYPTION_KEY'].encode()).decrypt(value.encode())),resolve=True)


def send_push(device,payload,ttl):
    import requests
    from pywebpush import webpush
    config=configuration()
    if not config:raise ValueError('Browser push not configured')
    class NoRedirectSession(requests.Session):
        def request(self,*args,**kwargs):
            kwargs['allow_redirects']=False
            return super().request(*args,**kwargs)
    subscription=decrypt_subscription(device.encrypted_subscription)
    with NoRedirectSession() as session:
        response=webpush(subscription_info=subscription,data=json.dumps(payload,separators=(',',':')),
            vapid_private_key=config['ORBITWATCH_VAPID_PRIVATE_KEY'],vapid_claims={'sub':config['ORBITWATCH_VAPID_SUBJECT']},
            ttl=max(0,min(3600,ttl)),timeout=5,requests_session=session)
    if response.status_code not in (200,201,202):raise ValueError('Push was not accepted')
    return response.status_code

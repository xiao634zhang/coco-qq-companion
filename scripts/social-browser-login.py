"""Manual website login in a dedicated browser; save only verified CLI sessions.

This is an application login entry point. It never drives account interactions
or reads the user's personal browser profile.
"""
from pathlib import Path
import json
import sys
import time
from camoufox.sync_api import Camoufox

root=Path(__file__).resolve().parent.parent
choice=sys.argv[1] if len(sys.argv)>1 else 'both'
if choice not in ('xhs','zhihu','both'):raise SystemExit('Choose xhs, zhihu or both')
platforms=['xhs','zhihu'] if choice=='both' else [choice]
states={p:{'stage':'starting'} for p in platforms}
last_checks={}
state_path=root/'data/social-browser-login-state.json'
def state(p,stage,**extra):
    states[p]={'stage':stage,'at':int(time.time()),**extra}
    temp=state_path.with_suffix('.tmp')
    temp.write_text(json.dumps(states,ensure_ascii=False),encoding='utf8')
    temp.replace(state_path)
    print(p,stage,flush=True)

def verify_and_save(p,cookies):
    if p=='xhs':
        from xhs_cli.client import XhsClient
        from xhs_cli.command_normalizers import normalize_xhs_user_payload
        from xhs_cli.cookies import save_cookies
        if not cookies.get('web_session') or not cookies.get('a1'):return False
        with XhsClient(cookies) as client:
            user=normalize_xhs_user_payload(client.get_self_info())
        if user.get('guest') or not user.get('id'):return False
        save_cookies(cookies)
    else:
        from zhihu_cli.client import ZhihuClient
        from zhihu_cli.auth import save_cookies
        from zhihu_cli.config import REQUIRED_COOKIES
        if not REQUIRED_COOKIES.issubset(cookies) or not cookies.get('z_c0'):return False
        with ZhihuClient(cookies) as client:info=client.get_self_info()
        if not info.get('id'):return False
        save_cookies('; '.join(k+'='+v for k,v in cookies.items()))
    return True

try:
    with Camoufox(headless=False) as browser:
        context=browser.new_context()
        pages={}
        for p in platforms:
            page=context.new_page();pages[p]=page
            page.goto('https://www.xiaohongshu.com/explore' if p=='xhs' else 'https://www.zhihu.com/signin',wait_until='domcontentloaded',timeout=45000)
            state(p,'waiting_for_manual_login')
        deadline=time.monotonic()+600
        while time.monotonic()<deadline:
            pending=[p for p in platforms if states[p]['stage']!='saved']
            if not pending:break
            if not context.pages:break
            for p in pending:
                origin='https://www.xiaohongshu.com' if p=='xhs' else 'https://www.zhihu.com'
                cookies={c['name']:c['value'] for c in context.cookies([origin])}
                marker=cookies.get('web_session' if p=='xhs' else 'z_c0','')
                old_marker,last_at=last_checks.get(p,('',0))
                if not marker or (marker==old_marker and time.monotonic()-last_at<20):continue
                last_checks[p]=(marker,time.monotonic())
                try:
                    if verify_and_save(p,cookies):state(p,'saved',verified=True)
                except Exception as exc:
                    state(p,'waiting_for_manual_login',lastVerificationError=type(exc).__name__)
            context.pages[0].wait_for_timeout(3000)
        for p in platforms:
            if states[p]['stage']!='saved':state(p,'not_completed')
except Exception as exc:
    for p in platforms:
        if states[p]['stage']!='saved':state(p,'failed',error=type(exc).__name__)
    raise SystemExit(1)
print('Verified sessions have been saved locally. No credentials were printed.',flush=True)

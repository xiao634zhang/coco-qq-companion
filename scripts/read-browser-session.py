"""Return only already-authorized platform cookies to coco's dedicated browser.
Never log this helper's stdout. It contains credentials for the named platform.
"""
import json,sys
platform=sys.argv[1]
if platform=='xhs':
 from xhs_cli.cookies import load_saved_cookies
 cookies=load_saved_cookies() or {}
 domain='.xiaohongshu.com'
elif platform=='zhihu':
 from zhihu_cli.auth import _load_saved_cookies
 raw=_load_saved_cookies() or ''
 cookies=dict(part.strip().split('=',1) for part in raw.split(';') if '=' in part)
 domain='.zhihu.com'
else:
 raise ValueError('Unsupported platform')
print(json.dumps([{'name':name,'value':value,'domain':domain,'path':'/','secure':True} for name,value in cookies.items() if isinstance(name,str) and isinstance(value,str)]))

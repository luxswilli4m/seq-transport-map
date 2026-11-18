#!/usr/bin/env python3
"""Add a version tag to index.html's links to css/js so browsers (e.g. iPad Safari) fetch fresh copies after an update.
Run before committing front-end changes: python3 tools/stamp.py"""
import re, time, os
p = os.path.join(os.path.dirname(__file__), "..", "index.html")
v = time.strftime("%Y%m%d%H%M")
s = open(p).read()
s = re.sub(r'((?:href|src)="(?:css/app\.css|js/app\.js|js/rt\.js))(\?v=\d+)?"', lambda m: f'{m.group(1)}?v={v}"', s)
open(p, "w").write(s); print("stamped", v)

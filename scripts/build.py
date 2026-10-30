"""Inject build/data.json into src/template.html -> dist/index.html"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = open(os.path.join(ROOT, 'build', 'data.json'), encoding='utf-8').read()
tpl = open(os.path.join(ROOT, 'src', 'template.html'), encoding='utf-8').read()
assert '/*DATA*/null' in tpl, 'placeholder /*DATA*/null missing from template'
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'index.html')
open(out, 'w', encoding='utf-8').write(tpl.replace('/*DATA*/null', data))
print('wrote', out)

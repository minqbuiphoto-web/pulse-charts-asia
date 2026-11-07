import ast
import re
import tempfile
import unicodedata
from pathlib import Path

source = Path('public/pulse-audio-ai-server.py').read_text(encoding='utf-8')
names = {'write_ass_subtitles','safe_font','ass_time','ass_escape','ass_color','readable_karaoke_color','clean_lyric_text'}
tree = ast.parse(source)
scope = dict(Path=Path,re=re,unicodedata=unicodedata,MV_EXPORT_LYRIC_LEAD_SECONDS=1)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'engine','exec'),scope)
rows = [dict(time=1+i*2,end=3+i*2,vietnamese=f'Line {i+1}') for i in range(4)]
with tempfile.TemporaryDirectory() as folder:
    target=Path(folder)/'test.ass'
    for width,height in [(1920,1080),(1080,1920)]:
        scope['write_ass_subtitles'](target,rows,{},dict(karaokeLines=2),'karaoke',width,height,0,20,0,'output',True)
        result=target.read_text(encoding='utf-8-sig')
        events=[line for line in result.splitlines() if line.startswith('Dialogue:')]
        assert len(events)==7, events
        waiting=[line for line in events if '\\1c' in line]
        assert any('0:00:01.00,0:00:03.00' in line and 'Line 2' in line for line in waiting)
        assert any('0:00:03.00,0:00:05.00' in line and 'Line 3' in line for line in waiting)
        assert any('0:00:05.00,0:00:07.00' in line and 'Line 4' in line for line in waiting)
        positions=[re.search(r'\\pos\(([^)]+)\)',line).group(1) for line in events]
        assert len(set(positions))==2
        assert '\\\\pos' not in result
    scope['write_ass_subtitles'](target,rows,{},dict(karaokeLines=1),'karaoke',1920,1080,0,20,0,'output',True)
    assert sum(line.startswith('Dialogue:') for line in target.read_text(encoding='utf-8-sig').splitlines())==4
print('PASS two-line ASS: waiting intervals, alternating positions, both formats and one-line compatibility')

"""Bounded text extraction; documents are data, never executed."""
import sys, json, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

def extract(path):
    if path.suffix.lower() == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(path)
        chunks = []
        for i, page in enumerate(reader.pages):
            if i >= 100 or sum(map(len, chunks)) >= 32000:
                chunks.append('\n[后续页面未读取]')
                break
            chunks.append(f'\n[第{i+1}页]\n' + (page.extract_text() or ''))
        return ''.join(chunks)
    with zipfile.ZipFile(path) as archive:
        def xml(name):
            info = archive.getinfo(name)
            if info.file_size > 16 * 1024 * 1024:
                raise ValueError('文档XML过大')
            return ET.fromstring(archive.read(name))
        if path.suffix.lower() == '.docx':
            return '\n'.join(''.join(p.itertext()) for p in xml('word/document.xml').iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(x.itertext()) for x in xml('xl/sharedStrings.xml')]
        ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        chunks = []
        for name in sorted(archive.namelist()):
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                chunks.append('\n[' + name + ']')
                for row in xml(name).findall('.//m:row', ns):
                    values = []
                    for cell in row.findall('m:c', ns):
                        value = cell.findtext('m:v', '', ns)
                        if cell.get('t') == 's': value = shared[int(value)]
                        if cell.get('t') == 'inlineStr': value = ''.join(cell.itertext())
                        values.append(cell.get('r', '') + '=' + value)
                    chunks.append(' | '.join(values))
                    if sum(map(len, chunks)) > 32000: return '\n'.join(chunks) + '\n[后续表格未读取]'
        return '\n'.join(chunks)

print(json.dumps({'text':extract(Path(sys.argv[1]))[:33000]}, ensure_ascii=True))

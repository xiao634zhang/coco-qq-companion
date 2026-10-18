import pathlib, urllib.request, hashlib, json
root=pathlib.Path(__file__).resolve().parent.parent
dest=root/'.runtime/kokoro'
dest.mkdir(parents=True,exist_ok=True)
sources={
 'kokoro-v1.1-zh.onnx':'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx',
 'voices-v1.1-zh.bin':'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin',
 'config.json':'https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/raw/main/config.json',
}
report=[]
for name,url in sources.items():
 p=dest/name
 if not p.exists():
  req=urllib.request.Request(url,headers={'User-Agent':'coco-local-voice/1.0'})
  with urllib.request.urlopen(req,timeout=120) as response,p.open('wb') as output:
   while chunk:=response.read(1024*1024):output.write(chunk)
  print('Downloaded '+name,flush=True)
 with p.open('rb') as f:checksum=hashlib.file_digest(f,'sha256').hexdigest()
 report.append({'file':name,'source':url,'bytes':p.stat().st_size,'sha256':checksum})
(root/'docs/neural-voice-models.json').write_text(json.dumps({'license':'Kokoro model Apache-2.0; kokoro-onnx MIT','files':report},indent=2),encoding='utf-8')

import sys, json, asyncio, os

def main():
    action = sys.argv[1]
    if action == 'transcribe':
        from faster_whisper import WhisperModel
        model = WhisperModel(sys.argv[3], device='cpu', compute_type='int8', download_root=sys.argv[4])
        segments, info = model.transcribe(sys.argv[2], vad_filter=True)
        print(json.dumps({'text': ''.join(s.text for s in segments), 'language': info.language}, ensure_ascii=True))
    elif action == 'speak':
        if sys.argv[3].startswith('kokoro:'):
            import pathlib, subprocess, imageio_ffmpeg, soundfile as sf
            import onnxruntime as ort
            from kokoro_onnx import Kokoro
            model_dir = pathlib.Path(__file__).resolve().parent.parent / '.runtime/kokoro'
            import jieba
            cache_dir = model_dir.parent/'cache/jieba'
            cache_dir.mkdir(parents=True, exist_ok=True)
            jieba.dt.tmp_dir = str(cache_dir)
            from misaki import zh
            target = pathlib.Path(sys.argv[4]).resolve()
            wav = target.with_suffix('.wav')
            g2p = zh.ZHG2P(version='1.1')
            phonemes, _ = g2p(sys.argv[2].replace('coco', '可可').replace('Coco', '可可'))
            kokoro = Kokoro(str(model_dir/'kokoro-v1.1-zh.onnx'), str(model_dir/'voices-v1.1-zh.bin'), vocab_config=str(model_dir/'config.json'))
            samples, sample_rate = kokoro.create(phonemes, voice=sys.argv[3].split(':', 1)[1], speed=1.0, is_phonemes=True)
            sf.write(str(wav), samples, sample_rate)
            try:
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error', '-i', str(wav), str(target)], check=True, timeout=60, capture_output=True)
            finally:
                wav.unlink(missing_ok=True)
        elif sys.argv[3] == 'sapi':
            import pathlib, subprocess, imageio_ffmpeg
            target = pathlib.Path(sys.argv[4]).resolve()
            source = target.with_suffix('.txt')
            wav = target.with_suffix('.wav')
            source.write_text(sys.argv[2], encoding='utf-8')
            try:
                subprocess.run(['powershell.exe', '-NoProfile', '-File', str(pathlib.Path(__file__).with_name('speak-local.ps1')), '-TextPath', str(source), '-OutputPath', str(wav)], check=True, timeout=60, capture_output=True)
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error', '-i', str(wav), str(target)], check=True, timeout=60, capture_output=True)
            finally:
                source.unlink(missing_ok=True)
                wav.unlink(missing_ok=True)
        else:
            import edge_tts
            asyncio.run(edge_tts.Communicate(sys.argv[2], sys.argv[3]).save(sys.argv[4]))
        print(json.dumps({'saved': True}))
    elif action == 'ffmpeg':
        import imageio_ffmpeg
        print(json.dumps({'path': imageio_ffmpeg.get_ffmpeg_exe()}))
    elif action == 'frames':
        import imageio_ffmpeg, subprocess, pathlib, base64
        out = pathlib.Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error', '-i', sys.argv[2], '-vf', 'fps=1/4,scale=640:-2', '-frames:v', '6', str(out / 'frame-%02d.jpg')], check=True, timeout=90)
        frames = [base64.b64encode(p.read_bytes()).decode('ascii') for p in sorted(out.glob('frame-*.jpg'))]
        if not frames:
            raise ValueError('No video frames produced')
        print(json.dumps({'frames': frames, 'notice': '每4秒一帧，最多前24秒；声音需要单独转录。'}))
    else:
        raise ValueError('Unknown media action')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        # URLs in upstream errors can contain service tokens; never expose them.
        print(json.dumps({'error': type(e).__name__, 'message': '媒体处理失败，请检查依赖、模型下载或音色服务。'}, ensure_ascii=True))
        sys.exit(1)

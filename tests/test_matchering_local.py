"""Run in an isolated matchering-venv alongside a temporary engine directory."""
import importlib.util
import io
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

source = Path(__file__).resolve().parents[1] / 'public/pulse-audio-ai-server.py'
spec = importlib.util.spec_from_file_location('pulse_engine', source)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
engine.__file__ = str(Path(sys.prefix).parent / 'server.py')

def audio(seconds=8, gain=1):
    rng = np.random.default_rng(17)
    t = np.arange(int(44100 * seconds)) / 44100
    wave = .14*np.sin(2*np.pi*220*t) + .07*np.sin(2*np.pi*880*t) + rng.normal(0,.015,len(t))
    data = np.column_stack((wave, np.roll(wave,19))) * gain
    out = io.BytesIO()
    sf.write(out,data,44100,format='WAV',subtype='PCM_24')
    return out.getvalue()

with TestClient(engine.app) as client:
    response = client.post('/matchering',files={'file':('song.wav',audio(),'audio/wav'),'reference':('ref.wav',audio(gain=1.4),'audio/wav')})
    assert response.status_code == 200, response.text
    info = sf.info(io.BytesIO(response.content))
    data,rate = sf.read(io.BytesIO(response.content))
    assert info.subtype == 'PCM_24'
    assert abs(info.duration-8)<.02
    assert np.isfinite(data).all() and np.max(np.abs(data)) <= 1
    invalid = client.post('/matchering',files={'file':('empty.wav',b'','audio/wav'),'reference':('ref.wav',audio(),'audio/wav')})
    assert invalid.status_code == 400
    print('PASS Matchering endpoint: reference master, 24-bit WAV, duration, finite output, empty-input rejection')

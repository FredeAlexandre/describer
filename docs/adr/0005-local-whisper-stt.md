# Local Whisper for on-device STT

The production Processor must turn a Source into timed Words without uploading media (ADR-0001). It runs multilingual Whisper in-process via Transformers.js (`Xenova/whisper-tiny`) in Node/Electron main, and uses local ffmpeg to decode 16 kHz mono PCM. Tests that need deterministic Words inject the fixture Processor into `openDescriber`.

**Considered options:** Transformers.js Whisper (chosen; Node, no extra runtime, French and English in one model); a Python/whisper.cpp sidecar (second toolchain); Vosk (one model per language); cloud STT (rejected by ADR-0001).

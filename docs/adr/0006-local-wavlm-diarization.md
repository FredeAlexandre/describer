# Local WavLM embeddings for on-device diarization

The production Processor must label Words as Speaker 1, Speaker 2, and so on without uploading media (ADR-0001). It splits the Source into speech regions, transcribes each region with the existing local Whisper pass, then clusters WavLM speaker embeddings (`Xenova/wavlm-base-plus-sv`) in-process so the same voice stays one Speaker. Tests that need deterministic Speakers keep injecting the fixture Processor; diarization tests assert Speaker names and Utterance splits through the Describer core.

**Considered options:** WavLM-SV embeddings plus centroid clustering on speech regions (chosen; same Transformers.js runtime as STT, unknown speaker count; whole-file Whisper-tiny dropped the second speaker); pyannote-segmentation-3.0 alone (local window IDs, not global Speakers); diarization-js or a Python sidecar (second pipeline).

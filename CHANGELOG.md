# APVINIX AI PRO changes

- Kept Netlify Drop static app, React/TypeScript frontend, Python FastAPI backend.
- Added optional high-resolution **piano model** separately from Basic Pitch.
- Added source-specific band limits for bass/vocal/other stem detections.
- Added original, unquantized inference MIDI for comparing rhythmic snapping.
- Added score/MIDI structural export validation (abort on malformed results).
- Added source-audio spectral evidence diagnostics and quality warnings; the UI never calls it true accuracy.
- Added quality report file & download endpoints, per-track statistics and UI alerts.
- Added single-worker computation limiter and `/api/health` engine installation flags.
- Disallowed silent lower-quality fallback in the default browser AI mode.
- Added tests for quality flagging, silent audio, piano track export and API downloads.

# Foreground retry is the canonical sync mechanism

JobDone uses foreground app-open retry as the canonical sync mechanism, with browser Background Sync treated only as an optional optimization. This was chosen because Background Sync support is inconsistent across mobile browsers, especially iOS PWAs, and offline-first correctness cannot depend on a best-effort browser feature.

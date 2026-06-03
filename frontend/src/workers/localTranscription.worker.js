self.addEventListener('message', async (event) => {
  const { id, type } = event.data || {};
  if (!id || type !== 'transcribe') return;

  self.postMessage({
    id,
    result: {
      ok: false,
      reason: 'runtime_not_integrated',
      provider: 'whisper.cpp',
      status: 'placeholder',
    },
  });
});

self.onmessage = async (event) => {
  const { jobId, file, maxEdge = 2000, quality = 0.8 } = event.data || {};

  try {
    if (!file || !file.type?.startsWith?.('image/')) {
      throw new Error('Choose an image file.');
    }

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });

    self.postMessage({
      jobId,
      ok: true,
      blob,
      metadata: {
        width,
        height,
        mimeType: blob.type || 'image/jpeg',
        size: blob.size,
        originalName: file.name || '',
        originalSize: file.size || 0,
        originalType: file.type || '',
      },
    });
  } catch (error) {
    self.postMessage({
      jobId,
      ok: false,
      error: error?.message || 'Photo compression failed.',
    });
  }
};

import { useMemo, useState } from 'react';
import { apiService } from './services/apiService';
import { getShinyProjectOwnerId } from './services/shinyProjectIdentityService';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',').pop() : value);
    };
    reader.readAsDataURL(file);
  });
}

function previewUrlFor(result) {
  if (!result?.previewImage?.dataBase64) return '';
  return `data:${result.previewImage.mimeType || 'image/jpeg'};base64,${result.previewImage.dataBase64}`;
}

export function ShinyArtShopScreen() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [project, setProject] = useState(null);
  const previewUrl = useMemo(() => previewUrlFor(project), [project]);

  const onFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const result = await apiService.createShinyProject({
        ownerUserId: getShinyProjectOwnerId(),
        filename: file.name || 'uploaded-image.jpg',
        mimeType: file.type || 'image/jpeg',
        dataBase64,
      });
      setProject(result);
    } catch (uploadError) {
      setError(uploadError?.message || 'Upload failed');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  if (project) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Preview saved</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your shiny picture preview</h1>
            <p className="mt-2 text-sm text-zinc-300">First slice: showing your uploaded image unchanged. Project created and saved.</p>
          </div>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Uploaded preview"
              className="max-h-[70vh] w-full rounded-lg border border-zinc-800 object-contain"
            />
          )}
          <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
            Project ID: <span className="font-mono text-zinc-200">{project.projectId}</span>
          </div>
          <button
            type="button"
            className="self-start rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950"
            onClick={() => setProject(null)}
          >
            Start another
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <main className="mx-auto grid min-h-screen w-full max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_0.9fr] md:items-center">
        <section className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Shiny Art Shop</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Turn a photo into embossed metal art</h1>
            <p className="mt-3 max-w-xl text-base text-zinc-300">
              Upload a photo. We make a first visual direction, then quote the real custom piece before work starts.
            </p>
          </div>

          <label className="block w-full max-w-sm cursor-pointer rounded-lg bg-amber-300 px-5 py-4 text-center text-sm font-semibold text-zinc-950 shadow hover:bg-amber-200">
            {uploading ? 'Uploading...' : 'Upload a picture'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={onFileSelected}
            />
          </label>
          {error && (
            <p className="max-w-sm rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
        </section>

        <img
          src="/shiny-art-shop/process-mockup.png"
          alt="Example embossed metal picture process"
          className="w-full rounded-lg border border-zinc-800 object-cover shadow-2xl"
        />
      </main>
    </div>
  );
}

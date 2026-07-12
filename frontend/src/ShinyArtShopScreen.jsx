import { useEffect, useMemo, useState } from 'react';
import { apiService } from './services/apiService';
import { createShinyProjectId, getShinyProjectOwnerId } from './services/shinyProjectIdentityService';

const fallbackOptions = {
  productTypes: [
    { value: 'embossed_metal_picture', label: 'Embossed metal picture' },
    { value: 'layered_card_artwork', label: '3D layered card picture' },
  ],
  materials: [
    { value: 'aluminium', label: 'Aluminium' },
    { value: 'copper_effect', label: 'Copper effect' },
    { value: 'brass_effect', label: 'Brass effect' },
    { value: 'brushed_steel_effect', label: 'Brushed steel effect' },
    { value: 'white_card', label: 'White card' },
    { value: 'black_core_card', label: 'Black core card' },
    { value: 'coloured_core_card', label: 'Coloured core card' },
    { value: 'kraft_card', label: 'Kraft card' },
  ],
  finishes: [
    { value: 'natural', label: 'Natural' },
    { value: 'framed', label: 'Framed' },
  ],
};

const initialDirection = {
  productType: 'embossed_metal_picture',
  material: 'copper_effect',
  finish: 'natural',
  styleNotes: '',
};

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

function dataUrl(mimeType, dataBase64) {
  return dataBase64 ? `data:${mimeType || 'image/jpeg'};base64,${dataBase64}` : '';
}

function projectIdFromUrl(location = window.location) {
  const params = new URLSearchParams(location.search || '');
  const value = params.get('project');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '') ? value : null;
}

function setProjectIdInUrl(projectId, history = window.history, location = window.location) {
  const url = new URL(location.href);
  url.searchParams.set('project', projectId);
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function clearProjectIdFromUrl(history = window.history, location = window.location) {
  const url = new URL(location.href);
  url.searchParams.delete('project');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function projectStateFromLoadedProject(result) {
  return {
    projectId: result.projectId,
    ownerUserId: result.ownerUserId,
    sourceImageId: result.sourceImageId,
    sourcePreviewUrl: dataUrl(result.sourceImage?.mimeType, result.sourceImage?.dataBase64),
  };
}

function OptionSelect({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-amber-300"
      >
        {(options || []).map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ShinyArtShopScreen() {
  const [options, setOptions] = useState(fallbackOptions);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [project, setProject] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [designDirection, setDesignDirection] = useState(initialDirection);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generatedPreview, setGeneratedPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiService.getShinyDesignOptions()
      .then(result => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions(fallbackOptions);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const projectId = projectIdFromUrl();
    if (!projectId) return;
    let cancelled = false;
    setLoadingProject(true);
    setUploadError('');
    apiService.getShinyProject({
      projectId,
      ownerUserId: getShinyProjectOwnerId(),
    })
      .then(result => {
        if (cancelled) return;
        setProject(projectStateFromLoadedProject(result));
        setDesignDirection(result.designDirection || initialDirection);
        setGeneratedPreview(result.previewImage || null);
      })
      .catch(error => {
        if (cancelled) return;
        setUploadError(error?.message || 'Project unavailable');
        clearProjectIdFromUrl();
      })
      .finally(() => {
        if (!cancelled) setLoadingProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sourcePreviewUrl = useMemo(() => project?.sourcePreviewUrl || '', [project]);
  const generatedPreviewUrl = useMemo(
    () => dataUrl(generatedPreview?.mimeType, generatedPreview?.dataBase64),
    [generatedPreview]
  );

  const onFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setGenerationError('');
    setGeneratedPreview(null);
    setUploading(true);

    const projectId = createShinyProjectId();
    const ownerUserId = getShinyProjectOwnerId();
    const mimeType = file.type || 'image/jpeg';
    try {
      const dataBase64 = await fileToBase64(file);
      const sourcePreview = dataUrl(mimeType, dataBase64);
      setProject({
        projectId,
        ownerUserId,
        sourceImageId: null,
        sourcePreviewUrl: sourcePreview,
      });
      setProjectIdInUrl(projectId);
      const result = await apiService.createShinyProject({
        projectId,
        ownerUserId,
        filename: file.name || 'uploaded-image.jpg',
        mimeType,
        dataBase64,
      });
      setProject(current => ({
        ...(current || {}),
        projectId: result.projectId,
        ownerUserId,
        sourceImageId: result.sourceImageId,
        sourcePreviewUrl: sourcePreview,
      }));
    } catch (error) {
      setUploadError(error?.message || 'Upload failed');
      clearProjectIdFromUrl();
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const updateDirection = (key, value) => {
    setDesignDirection(current => ({ ...current, [key]: value }));
    setGenerationError('');
  };

  const requestPreview = async () => {
    if (!project?.projectId || !project?.sourceImageId || generating) return;
    setGenerating(true);
    setGenerationError('');
    try {
      const result = await apiService.requestShinyDesignPreview({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        sourceImageId: project.sourceImageId,
        designDirection,
      });
      setGeneratedPreview(result.previewImage || null);
    } catch {
      setGenerationError('Oops, we had a problem. Try again in a few minutes.');
    } finally {
      setGenerating(false);
    }
  };

  if (project) {
    const canRequestPreview = Boolean(project.sourceImageId) && !uploading && !generating;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50">
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 px-4 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Shiny Art Shop</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create your preview</h1>
          </div>

          <div className="grid gap-5 md:grid-cols-[0.9fr_1fr]">
            <div className="space-y-3">
              {sourcePreviewUrl && (
                <img
                  src={sourcePreviewUrl}
                  alt="Uploaded source"
                  className="max-h-[58vh] w-full rounded-lg border border-zinc-800 object-contain"
                />
              )}
              <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                Project ID: <span className="font-mono text-zinc-200">{project.projectId}</span>
              </div>
            </div>

            <section className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <OptionSelect
                label="Artwork type"
                value={designDirection.productType}
                options={options.productTypes}
                onChange={value => updateDirection('productType', value)}
              />
              <OptionSelect
                label="Material"
                value={designDirection.material}
                options={options.materials}
                onChange={value => updateDirection('material', value)}
              />
              <OptionSelect
                label="Finish"
                value={designDirection.finish}
                options={options.finishes}
                onChange={value => updateDirection('finish', value)}
              />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</span>
                <textarea
                  value={designDirection.styleNotes}
                  rows={3}
                  maxLength={500}
                  onChange={event => updateDirection('styleNotes', event.target.value)}
                  className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-amber-300"
                />
              </label>

              <button
                type="button"
                className="w-full rounded bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canRequestPreview}
                onClick={requestPreview}
              >
                {generating ? 'Creating preview...' : generationError ? 'Retry' : 'Create preview'}
              </button>
              <p className="text-xs text-zinc-400">
                {generating ? 'This usually takes a few seconds.' : uploading ? 'Uploading image...' : ''}
              </p>
              {(uploadError || generationError) && (
                <p className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">
                  {uploadError || generationError}
                </p>
              )}
            </section>
          </div>

          {generatedPreviewUrl && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">Your design preview</h2>
              <img
                src={generatedPreviewUrl}
                alt="Generated design preview"
                className="max-h-[80vh] w-full rounded-lg border border-zinc-800 object-contain"
              />
              <p className="text-sm text-zinc-300">
                Your final piece will be handmade from real materials, so small differences are part of the process.
              </p>
            </section>
          )}
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
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Turn a photo into embossed metal art or a 3D card picture</h1>
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
          {uploadError && (
            <p className="max-w-sm rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">
              {uploadError}
            </p>
          )}
          {loadingProject && (
            <p className="text-sm text-zinc-400">Loading project...</p>
          )}
        </section>

        <img
          src="/shiny-art-shop/process-mockup.png"
          alt="Example embossed metal picture process"
          className="max-h-[78vh] w-full rounded-lg border border-zinc-800 object-contain shadow-2xl"
        />
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { apiService } from './services/apiService';

function dataUrl(image) {
  return image?.dataBase64 ? `data:${image.mimeType || 'image/jpeg'};base64,${image.dataBase64}` : '';
}

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

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'No quote';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function label(value) {
  return String(value || '').replace(/_/g, ' ');
}

function projectUrl(project) {
  const params = new URLSearchParams({
    project: project.projectId,
    owner: project.ownerUserId,
  });
  return `/?${params.toString()}#shiny-art-shop`;
}

function statusLabel(status) {
  return {
    ready_for_workshop: 'Ready for workshop',
    in_production: 'In production',
    awaiting_customer_approval: 'Photo uploaded',
  }[status] || label(status);
}

export function ShinyWorkshopScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [busyProjectId, setBusyProjectId] = useState('');
  const [actionErrors, setActionErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiService.getShinyWorkshopQueue()
      .then(result => {
        if (!cancelled) setProjects(result.projects || result.readyForWorkshop || []);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message || 'Workshop queue unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replaceProject = (updated) => {
    setProjects(current => current.map(project => (
      project.projectId === updated.projectId && project.ownerUserId === updated.ownerUserId
        ? {
            ...project,
            projectStatus: updated.projectStatus,
            thumbnail: updated.workshopPhoto || updated.previewImage || updated.sourceImage || project.thumbnail,
            workshopPhoto: updated.workshopPhoto || project.workshopPhoto || null,
            quote: updated.quote || project.quote,
            quoteAccepted: Boolean(updated.quoteAccepted),
            requiredPaymentReceived: Boolean(updated.requiredPaymentReceived),
          }
        : project
    )));
  };

  const startProduction = async (project) => {
    if (!project.quote?.id) return;
    setBusyProjectId(project.projectId);
    setActionErrors(current => ({ ...current, [project.projectId]: '' }));
    try {
      const updated = await apiService.startShinyProduction({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        quoteSnapshotId: project.quote.id,
        confirmationText: 'Workshop checked payment and terms before starting production.',
      });
      replaceProject(updated);
    } catch (err) {
      setActionErrors(current => ({ ...current, [project.projectId]: err?.message || 'Production start failed' }));
    } finally {
      setBusyProjectId('');
    }
  };

  const uploadFinishedPhoto = async (project, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusyProjectId(project.projectId);
    setActionErrors(current => ({ ...current, [project.projectId]: '' }));
    try {
      const dataBase64 = await fileToBase64(file);
      const updated = await apiService.uploadShinyWorkshopPhoto({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        filename: file.name || 'finished-photo.jpg',
        mimeType: file.type || 'image/jpeg',
        dataBase64,
      });
      replaceProject(updated);
    } catch (err) {
      setActionErrors(current => ({ ...current, [project.projectId]: err?.message || 'Finished photo upload failed' }));
    } finally {
      setBusyProjectId('');
    }
  };

  const countLabel = useMemo(() => {
    if (loading) return 'Loading';
    return `${projects.length} ready`;
  }, [loading, projects.length]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Shiny Art Shop</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Workshop queue</h1>
            <p className="mt-1 text-sm text-zinc-400">{countLabel}</p>
          </div>
          <a
            href="#shiny-art-shop"
            className="rounded border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-amber-300 hover:text-amber-200"
          >
            Customer page
          </a>
        </header>

        {error && (
          <p className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">{error}</p>
        )}

        {loading && (
          <p className="rounded border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">Loading queue...</p>
        )}

        {!loading && !projects.length && !error && (
          <p className="rounded border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
            No paid projects are ready for workshop yet.
          </p>
        )}

        <section className="grid gap-4">
          {projects.map(project => {
            const imageUrl = dataUrl(project.thumbnail);
            const quoteResult = project.quote?.result || {};
            const direction = project.designDirection || {};
            const quoteInput = project.quoteInput || {};
            const busy = busyProjectId === project.projectId;
            const actionError = actionErrors[project.projectId] || '';
            return (
              <article key={`${project.ownerUserId}:${project.projectId}`} className="grid gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:grid-cols-[180px_1fr]">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-44 w-full rounded border border-zinc-800 object-contain sm:h-full"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
                    No image
                  </div>
                )}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{project.title}</h2>
                      <p className="mt-1 font-mono text-xs text-zinc-500">{project.projectId}</p>
                    </div>
                    <span className="rounded bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
                      {statusLabel(project.projectStatus)}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Total</dt><dd>{money(quoteResult.price)}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Size / Qty</dt><dd>{quoteInput.size || '-'} x {quoteInput.quantity || '-'}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Artwork</dt><dd>{label(direction.productType)}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Material</dt><dd>{label(direction.material)}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Finish</dt><dd>{label(direction.finish)}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wide text-zinc-500">Deadline</dt><dd>{label(quoteInput.deadline || 'standard')}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {project.projectStatus === 'ready_for_workshop' && (
                      <button
                        type="button"
                        className="rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busy}
                        onClick={() => startProduction(project)}
                      >
                        {busy ? 'Starting...' : 'Start production'}
                      </button>
                    )}
                    {project.projectStatus === 'in_production' && (
                      <label className="cursor-pointer rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-200">
                        {busy ? 'Uploading...' : 'Upload finished photo'}
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          disabled={busy}
                          onChange={event => uploadFinishedPhoto(project, event)}
                        />
                      </label>
                    )}
                    <a
                      href={projectUrl(project)}
                      className="inline-flex rounded border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-amber-300 hover:text-amber-200"
                    >
                      Open project
                    </a>
                  </div>
                  {project.projectStatus === 'awaiting_customer_approval' && (
                    <p className="rounded border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
                      Finished photo uploaded. Customer approval is the next step.
                    </p>
                  )}
                  {actionError && (
                    <p className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">{actionError}</p>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

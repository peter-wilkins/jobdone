import { useEffect, useMemo, useState } from 'react';
import { apiService } from './services/apiService';
import { createShinyProjectId, getShinyProjectOwnerId } from './services/shinyProjectIdentityService';
import { evaluateQuote, shinyArtShopQuoteRules } from '../../shared/shiny-project/index.js';

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

const initialQuoteInput = {
  productType: initialDirection.productType,
  material: initialDirection.material,
  finish: initialDirection.finish,
  size: 'A4',
  quantity: 1,
  deadline: 'standard',
  orderNotes: '',
};

const deadlineOptions = [
  { value: 'standard', label: 'Standard' },
  { value: 'rush_3_5_days', label: 'Rush: 3-5 days' },
  { value: 'next_day', label: 'Next day' },
];

const CUSTOM_ORDER_TERMS_VERSION = 'custom-order-terms:v1';
const CUSTOM_ORDER_TERMS_TEXT = 'I understand this is custom-made. I can cancel before production starts, but once production starts I cannot cancel for a change of mind. My statutory rights are not affected.';

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

function money(value) {
  if (!Number.isFinite(value)) return 'Needs review';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
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

function OptionSelect({ label, value, options, onChange, disabled = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <select
        value={value}
        disabled={disabled}
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
  const [quoteInput, setQuoteInput] = useState(initialQuoteInput);
  const [quote, setQuote] = useState(null);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [acceptingQuote, setAcceptingQuote] = useState(false);
  const [paying, setPaying] = useState(false);

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
        if (result.designDirection) {
          setQuoteInput(current => ({
            ...current,
            productType: result.designDirection.productType,
            material: result.designDirection.material,
            finish: result.designDirection.finish,
          }));
        }
        setQuote(result.quote || null);
        setQuoteAccepted(Boolean(result.quoteAccepted));
        setPaymentReceived(Boolean(result.requiredPaymentReceived));
        setTermsAccepted(Boolean(result.quoteAccepted));
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
  const liveQuote = useMemo(() => evaluateQuote(shinyArtShopQuoteRules.latest, quoteInput), [quoteInput]);

  const onFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setGenerationError('');
    setGeneratedPreview(null);
    setQuote(null);
    setQuoteAccepted(false);
    setPaymentReceived(false);
    setTermsAccepted(false);
    setQuoteError('');
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
    if (['productType', 'material', 'finish'].includes(key)) {
      setQuoteInput(current => ({ ...current, [key]: value }));
      setQuote(null);
      setQuoteAccepted(false);
      setPaymentReceived(false);
      setTermsAccepted(false);
    }
    setGenerationError('');
  };

  const updateQuoteInput = (key, value) => {
    if (paymentReceived) return;
    setQuoteInput(current => ({
      ...current,
      [key]: key === 'quantity' ? Math.min(100, Math.max(1, Number(value) || 1)) : value,
    }));
    setQuote(null);
    setQuoteAccepted(false);
    setPaymentReceived(false);
    setTermsAccepted(false);
    setQuoteError('');
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
      setQuote(null);
      setQuoteAccepted(false);
      setPaymentReceived(false);
      setTermsAccepted(false);
    } catch {
      setGenerationError('Oops, we had a problem. Try again in a few minutes.');
    } finally {
      setGenerating(false);
    }
  };

  const submitQuote = async () => {
    if (!project?.projectId || quoteSaving) return;
    setQuoteSaving(true);
    setQuoteError('');
    try {
      const result = await apiService.configureShinyQuote({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        quoteInput,
      });
      setQuote(result.quote || null);
      setQuoteAccepted(Boolean(result.quoteAccepted));
      setPaymentReceived(Boolean(result.requiredPaymentReceived));
      setTermsAccepted(Boolean(result.quoteAccepted));
    } catch (error) {
      setQuoteError(error?.message || 'Quote failed');
    } finally {
      setQuoteSaving(false);
    }
  };

  const acceptQuote = async () => {
    if (!project?.projectId || !quote?.id || acceptingQuote || !termsAccepted) return;
    setAcceptingQuote(true);
    setQuoteError('');
    try {
      const result = await apiService.acceptShinyQuote({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        quoteSnapshotId: quote.id,
        termsVersion: CUSTOM_ORDER_TERMS_VERSION,
        termsText: CUSTOM_ORDER_TERMS_TEXT,
      });
      setQuote(result.quote || quote);
      setQuoteAccepted(Boolean(result.quoteAccepted));
      setPaymentReceived(Boolean(result.requiredPaymentReceived));
    } catch (error) {
      setQuoteError(error?.message || 'Quote acceptance failed');
    } finally {
      setAcceptingQuote(false);
    }
  };

  const payNow = async () => {
    if (!project?.projectId || !quote?.id || paying) return;
    setPaying(true);
    setQuoteError('');
    try {
      const result = await apiService.payShinyQuoteNow({
        projectId: project.projectId,
        ownerUserId: project.ownerUserId,
        quoteSnapshotId: quote.id,
      });
      setQuote(result.quote || quote);
      setQuoteAccepted(Boolean(result.quoteAccepted));
      setPaymentReceived(Boolean(result.requiredPaymentReceived));
    } catch (error) {
      setQuoteError(error?.message || 'Payment failed');
    } finally {
      setPaying(false);
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
              <section className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Quote</h2>
                  <p className="mt-1 text-sm text-zinc-400">Adjust size, quantity, and deadline. Price updates here before checkout.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <OptionSelect
                    label="Size"
                    value={quoteInput.size}
                    options={[
                      { value: 'A5', label: 'A5' },
                      { value: 'A4', label: 'A4' },
                    ]}
                    disabled={paymentReceived}
                    onChange={value => updateQuoteInput('size', value)}
                  />
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Quantity</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={quoteInput.quantity}
                      disabled={paymentReceived}
                      onChange={event => updateQuoteInput('quantity', event.target.value)}
                      className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-amber-300"
                    />
                  </label>
                  <OptionSelect
                    label="Deadline"
                    value={quoteInput.deadline}
                    options={deadlineOptions}
                    disabled={paymentReceived}
                    onChange={value => updateQuoteInput('deadline', value)}
                  />
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Order notes</span>
                  <textarea
                    value={quoteInput.orderNotes}
                    rows={3}
                    maxLength={2000}
                    disabled={paymentReceived}
                    onChange={event => updateQuoteInput('orderNotes', event.target.value)}
                    placeholder="Anything that changes the job scope goes here."
                    className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-amber-300"
                  />
                </label>

                <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-300">Estimated total</span>
                    <span className="text-2xl font-semibold text-amber-200">{money(liveQuote.priceEstimate)}</span>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                    {liveQuote.explanation.map(line => <li key={line}>{line}</li>)}
                  </ul>
                  {liveQuote.canAutoQuote ? (
                    <p className="mt-3 text-sm text-zinc-300">
                      Due now: {money(liveQuote.depositDue)}. Full payment is required before workshop work starts.
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-amber-200">A human will review this and get back to you before checkout.</p>
                  )}
                </div>

                <button
                  type="button"
                  className="w-full rounded bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={quoteSaving || paymentReceived}
                  onClick={submitQuote}
                >
                  {quoteSaving ? 'Saving quote...' : liveQuote.canAutoQuote ? 'Save quote' : 'Send for review'}
                </button>
                {quoteError && (
                  <p className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-100">{quoteError}</p>
                )}
                {quote && (
                  <div className="space-y-3 rounded border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-100">
                    <p>{quote.canAutoQuote ? 'Quote saved.' : 'Review request saved.'}</p>
                    {quote.canAutoQuote && !quoteAccepted && (
                      <>
                        <label className="flex gap-3 text-left text-sm text-zinc-100">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-amber-300"
                            checked={termsAccepted}
                            onChange={event => setTermsAccepted(event.target.checked)}
                          />
                          <span>{CUSTOM_ORDER_TERMS_TEXT}</span>
                        </label>
                        <button
                          type="button"
                          className="w-full rounded bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!termsAccepted || acceptingQuote}
                          onClick={acceptQuote}
                        >
                          {acceptingQuote ? 'Accepting...' : 'Accept quote'}
                        </button>
                      </>
                    )}
                    {quote.canAutoQuote && quoteAccepted && !paymentReceived && (
                      <>
                        <p>Quote accepted. Pay {money(quote.result.depositDue)} now to join the workshop queue.</p>
                        <button
                          type="button"
                          className="w-full rounded bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={paying}
                          onClick={payNow}
                        >
                          {paying ? 'Recording payment...' : 'Pay now'}
                        </button>
                      </>
                    )}
                    {paymentReceived && (
                      <p>Payment recorded. Your project is ready for the workshop queue.</p>
                    )}
                  </div>
                )}
              </section>
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

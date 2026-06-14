import { useId, useState } from 'react';
import {
  appendComposerText,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
  rejectCaptureComposerDraft,
  shouldEnableComposerSubmit,
  submitCaptureComposerDraft,
} from './services/captureComposerService';

export function CaptureComposer({
  draftKey,
  defaultText = '',
  label = 'Entry',
  placeholder = 'Capture what happened now so your future self can find it later.',
  helperText = '',
  submitLabel = 'Save',
  discardLabel = 'Discard',
  busy = false,
  requireText = true,
  attachments = [],
  attachmentSlot = null,
  toolSlot = null,
  suggestions = [],
  suggestionLabel = 'Suggestions',
  rows = 2,
  onConfirm,
  onReject,
  onSubmit,
  onDiscard,
  onTextChange,
}) {
  const textareaId = useId();
  const [text, setText] = useState(() => loadComposerDraft(draftKey) ?? defaultText);
  const [error, setError] = useState('');
  const confirmAdapter = onConfirm || onSubmit;
  const rejectAdapter = onReject || onDiscard;

  const updateText = (nextText) => {
    setText(nextText);
    setError('');
    saveComposerDraft(draftKey, nextText);
    onTextChange?.(nextText);
  };

  const applySuggestion = (suggestionText) => {
    updateText(appendComposerText(text, suggestionText));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!shouldEnableComposerSubmit({ text, attachments, requireText, busy })) return;
    setError('');
    try {
      await submitCaptureComposerDraft({
        text,
        attachments,
        draftKey,
        onSubmit: confirmAdapter,
      });
      resetComposer();
    } catch (err) {
      setError(err?.message || 'Could not save. Try again.');
    }
  };

  const resetComposer = () => {
    setText('');
    setError('');
    clearComposerDraft(draftKey);
    onTextChange?.('');
  };

  const reject = async () => {
    const hasWork = text.trim() || (attachments || []).length > 0;
    if (hasWork && !window.confirm('Discard this capture?')) return;
    setError('');
    try {
      if (rejectAdapter) {
        await rejectCaptureComposerDraft({
          text,
          attachments,
          draftKey,
          onReject: rejectAdapter,
        });
      } else {
        clearComposerDraft(draftKey);
      }
      resetComposer();
    } catch (err) {
      setError(err?.message || 'Could not save. Try again.');
    }
  };

  const canSubmit = shouldEnableComposerSubmit({ text, attachments, requireText, busy });

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <label htmlFor={textareaId} className="sr-only">{label}</label>
      <textarea
        id={textareaId}
        value={text}
        onChange={(event) => updateText(event.target.value)}
        rows={Math.max(rows, Math.min(16, text.split('\n').length + Math.ceil(text.length / 44)))}
        className="min-h-28 w-full resize-y rounded border border-gray-300 px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
        placeholder={placeholder}
      />
      {helperText && (
        <p className="text-xs text-gray-500">{helperText}</p>
      )}
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500">{suggestionLabel}</p>
          {suggestions.map(suggestion => (
            <button
              key={suggestion.id || suggestion.text}
              type="button"
              onClick={() => applySuggestion(suggestion.text)}
              className="block w-full rounded border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
            >
              <span className="block max-h-10 overflow-hidden leading-5">{suggestion.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {toolSlot}
          {attachmentSlot}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy || (!text.trim() && !(attachments || []).length)}
            onClick={reject}
            className="flex h-9 w-9 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title={discardLabel}
            aria-label={discardLabel}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-9 w-9 items-center justify-center rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            title={busy ? 'Saving...' : submitLabel}
            aria-label={busy ? 'Saving...' : submitLabel}
          >
            {busy ? (
              <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs font-medium text-red-700">{error}</p>
      )}
    </form>
  );
}

import { useId, useState } from 'react';
import {
  appendComposerText,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
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
  suggestions = [],
  suggestionLabel = 'Suggestions',
  rows = 2,
  onSubmit,
  onDiscard,
  onTextChange,
}) {
  const textareaId = useId();
  const [text, setText] = useState(() => loadComposerDraft(draftKey) ?? defaultText);
  const [error, setError] = useState('');

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
        onSubmit,
      });
      setText('');
      onTextChange?.('');
    } catch (err) {
      setError(err?.message || 'Could not save. Try again.');
    }
  };

  const discard = () => {
    setText('');
    setError('');
    clearComposerDraft(draftKey);
    onTextChange?.('');
    onDiscard?.();
  };

  const canSubmit = shouldEnableComposerSubmit({ text, attachments, requireText, busy });

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label htmlFor={textareaId} className="sr-only">{label}</label>
      <textarea
        id={textareaId}
        value={text}
        onChange={(event) => updateText(event.target.value)}
        rows={rows}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
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
      {attachmentSlot}
      {error && (
        <p className="text-xs font-medium text-red-700">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? 'Saving...' : submitLabel}
        </button>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={discard}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {discardLabel}
        </button>
      </div>
    </form>
  );
}

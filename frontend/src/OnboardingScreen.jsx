import { useState } from 'react';
import {
  buildCaptureContext,
  captureContextService,
  CAPTURE_CONTEXT_TEMPLATES,
} from './services/captureContextService';

export function OnboardingScreen({ onBack }) {
  const savedContext = captureContextService.get();
  const [contextTemplateId, setContextTemplateId] = useState(
    savedContext?.templateId || CAPTURE_CONTEXT_TEMPLATES[0].id
  );
  const [contextNotes, setContextNotes] = useState(savedContext?.notes || '');
  const [saved, setSaved] = useState(false);

  const saveCaptureContext = () => {
    const next = buildCaptureContext(contextTemplateId, contextNotes);
    captureContextService.save(next);
    setSaved(true);
  };

  return (
    <div className="min-h-screen bg-white px-4 py-5">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Back
        </button>

        <div className="border-b border-gray-200 pb-4">
          <h1 className="text-2xl font-light text-gray-900">Onboarding</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set what you mostly use JobDone for. This helps JobDone guess useful context while you capture notes.
          </p>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {CAPTURE_CONTEXT_TEMPLATES.map(template => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                setContextTemplateId(template.id);
                setSaved(false);
              }}
              className={`rounded border px-3 py-3 text-left ${
                contextTemplateId === template.id
                  ? 'border-gray-900 bg-gray-50 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="block text-sm font-medium">{template.label}</span>
              <span className="mt-1 block text-xs text-gray-500">{template.examples}</span>
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="text-xs font-medium text-gray-600">Extra context, optional</span>
          <textarea
            value={contextNotes}
            onChange={(event) => {
              setContextNotes(event.target.value);
              setSaved(false);
            }}
            rows={4}
            maxLength={240}
            placeholder="Examples: mostly garden maintenance for my own home; classic cars; rental property repairs."
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
          />
        </label>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-500">
            {saved ? 'Saved.' : savedContext ? 'Current default can be changed here.' : 'No default saved yet.'}
          </p>
          <button
            type="button"
            onClick={saveCaptureContext}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

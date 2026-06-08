import { useState } from 'react';
import { evidenceTextForEntry, suggestEvidenceEntries } from './services/evidenceSuggestionService';
import {
  itemPointsEnabled,
  itemUsesManualApproval,
  pointsText,
  statusText,
  teamLabel,
} from './services/teamWorkItemService';

export function WorkItem({ item, pointsEnabled, usesManualApproval, recentEntries, onSubmit, busy }) {
  const [evidenceText, setEvidenceText] = useState('');
  const request = item.approval_request || {};
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  const rowUsesManualApproval = itemUsesManualApproval(item, usesManualApproval);
  const suggestions = suggestEvidenceEntries(item, recentEntries, 3);
  const includeSuggestion = (entry) => {
    const suggestedText = evidenceTextForEntry(entry);
    setEvidenceText(current => {
      const trimmed = current.trim();
      if (!trimmed) return suggestedText;
      if (trimmed.includes(suggestedText)) return current;
      return `${trimmed}\n\n${suggestedText}`;
    });
  };

  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            {[teamLabel(item), statusText(item.status, rowUsesManualApproval), pointsText(item, rowPointsEnabled)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
      {item.status !== 'submitted' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(item, evidenceText);
            setEvidenceText('');
          }}
          className="mt-3 space-y-2"
        >
          <textarea
            value={evidenceText}
            onChange={(event) => setEvidenceText(event.target.value)}
            rows={2}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            placeholder="Capture what happened now so your future self can find it later."
          />
          {suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Possible evidence</p>
              {suggestions.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => includeSuggestion(entry)}
                  className="block w-full rounded border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span className="block max-h-10 overflow-hidden leading-5">{evidenceTextForEntry(entry)}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !evidenceText.trim()}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Submit evidence
          </button>
        </form>
      )}
    </div>
  );
}

export function OpenItem({ item, pointsEnabled, onClaim, busy, claimError }) {
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            {[teamLabel(item), pointsText(item, rowPointsEnabled)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || Boolean(claimError)}
          onClick={() => onClaim(item)}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
        >
          Claim
        </button>
      </div>
      {claimError && (
        <p className="mt-2 text-xs font-medium text-red-700">{claimError} Pick another one.</p>
      )}
    </div>
  );
}

export function FinishedItem({ item, pointsEnabled }) {
  const request = item.approval_request || {};
  const points = pointsText(item, itemPointsEnabled(item, pointsEnabled));
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
      <p className="mt-1 text-xs text-gray-500">
        {[teamLabel(item), points].filter(Boolean).join(' · ')}
      </p>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
    </div>
  );
}


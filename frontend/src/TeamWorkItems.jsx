import { CaptureComposer } from './CaptureComposer';
import { PhotoAttachmentControls } from './PhotoAttachmentControls';
import { evidenceTextForEntry, suggestEvidenceEntries } from './services/evidenceSuggestionService';
import { usePhotoAttachments } from './services/photoAttachmentHooks';
import {
  itemPointsEnabled,
  itemUsesManualApproval,
  pointsText,
  statusText,
  teamLabel,
} from './services/teamWorkItemService';

export function WorkItem({ item, pointsEnabled, usesManualApproval, recentEntries, onSubmit, busy }) {
  const request = item.approval_request || {};
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  const rowUsesManualApproval = itemUsesManualApproval(item, usesManualApproval);
  const suggestions = suggestEvidenceEntries(item, recentEntries, 3);
  const composerSuggestions = suggestions.map(entry => ({
    id: entry.id,
    text: evidenceTextForEntry(entry),
  }));
  const evidencePhotos = usePhotoAttachments();

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
        <CaptureComposer
          draftKey={`team-evidence:${item.id}`}
          label={`Evidence for ${item.description || 'Backlog Item'}`}
          placeholder="Capture what happened now so your future self can find it later."
          helperText="Evidence is saved with this Team item."
          submitLabel="Submit evidence"
          discardLabel="Clear"
          busy={busy}
          requireText={false}
          attachments={evidencePhotos.attachments}
          rows={4}
          suggestions={composerSuggestions}
          suggestionLabel="Possible evidence"
          attachmentSlot={(
            <PhotoAttachmentControls
              attachments={evidencePhotos.attachments}
              onAddFiles={evidencePhotos.addFiles}
              onRemove={evidencePhotos.removeAttachment}
              error={evidencePhotos.error}
              disabled={busy}
            />
          )}
          onSubmit={({ text, attachments }) => onSubmit(item, text, attachments).then(() => evidencePhotos.reset())}
          onDiscard={evidencePhotos.reset}
        />
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

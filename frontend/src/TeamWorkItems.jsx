import { useEffect, useState } from 'react';
import { CaptureComposer } from './CaptureComposer';
import { CaptureContextControls } from './CaptureContextControls';
import { PhotoAttachmentControls } from './PhotoAttachmentControls';
import { evidenceTextForEntry, suggestEvidenceEntries } from './services/evidenceSuggestionService';
import { usePhotoAttachments } from './services/photoAttachmentHooks';
import {
  buildTeamCaptureCandidates,
  runTeamCapturePreExtraction,
  selectAutoAttachedContextClues,
} from './services/teamCaptureExtractionService';
import {
  itemPointsEnabled,
  itemUsesManualApproval,
  pointsText,
  statusText,
  teamLabel,
} from './services/teamWorkItemService';

export function WorkItem({
  item,
  pointsEnabled,
  usesManualApproval,
  recentEntries,
  onSubmit,
  busy,
  contacts = [],
  locations = [],
  tags = [],
  team = null,
  userId = '',
  enableContextControls = false,
}) {
  const request = item.approval_request || {};
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  const rowUsesManualApproval = itemUsesManualApproval(item, usesManualApproval);
  const suggestions = suggestEvidenceEntries(item, recentEntries, 3);
  const composerSuggestions = suggestions.map(entry => ({
    id: entry.id,
    text: evidenceTextForEntry(entry),
  }));
  const evidencePhotos = usePhotoAttachments();
  const [evidenceText, setEvidenceText] = useState('');
  const [candidates, setCandidates] = useState({ contacts: [], locations: [], tags: [] });
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [locationPanelOpen, setLocationPanelOpen] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);

  useEffect(() => {
    const nextCandidates = buildTeamCaptureCandidates({
      contacts,
      locations,
      tags,
      team,
      backlogItems: [item],
    });
    const preExtraction = runTeamCapturePreExtraction({
      captureText: evidenceText,
      candidates: nextCandidates,
      userId,
    });
    const suggested = selectAutoAttachedContextClues({ preExtraction, candidates: nextCandidates });
    setCandidates(nextCandidates);
    setSelectedLocation(current => current || suggested.locations[0] || null);
    setSelectedContact(current => current || suggested.contacts[0] || null);
  }, [contacts, evidenceText, item, locations, tags, team, userId]);

  const resetEvidenceCapture = () => {
    evidencePhotos.reset();
    setEvidenceText('');
    setSelectedLocation(null);
    setSelectedContact(null);
    setLocationPanelOpen(false);
    setContactPanelOpen(false);
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
          toolSlot={enableContextControls ? (
            <CaptureContextControls
              locationText={selectedLocation?.label || selectedLocation?.displayName || ''}
              locationPanelOpen={locationPanelOpen}
              locationCandidates={candidates.locations || []}
              onToggleLocation={() => setLocationPanelOpen(open => !open)}
              onLocationTextChange={(nextText) => setSelectedLocation(nextText ? {
                id: null,
                label: nextText,
                displayName: nextText,
                placeText: nextText,
              } : null)}
              onRemoveLocation={() => setSelectedLocation(null)}
              onSelectLocationCandidate={(candidate) => {
                setSelectedLocation(candidate);
                setLocationPanelOpen(false);
              }}
              selectedContact={selectedContact}
              contactPanelOpen={contactPanelOpen}
              contactCandidates={candidates.contacts || []}
              contactPickerSupported={false}
              onOpenContact={() => setContactPanelOpen(true)}
              onCloseContact={() => setContactPanelOpen(false)}
              onRemoveContact={() => setSelectedContact(null)}
              onSelectContactCandidate={(candidate) => {
                setSelectedContact(candidate);
                setContactPanelOpen(false);
              }}
            />
          ) : null}
          attachmentSlot={(
            <PhotoAttachmentControls
              attachments={evidencePhotos.attachments}
              onAddFiles={evidencePhotos.addFiles}
              onRemove={evidencePhotos.removeAttachment}
              error={evidencePhotos.error}
              disabled={busy}
            />
          )}
          onTextChange={setEvidenceText}
          onConfirm={({ text, attachments }) => onSubmit(item, text, attachments, {
            locations: selectedLocation ? [selectedLocation] : [],
            contacts: selectedContact ? [selectedContact] : [],
            tags: [],
          }).then(resetEvidenceCapture)}
          onReject={resetEvidenceCapture}
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

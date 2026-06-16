export function CaptureContextControls({
  locationText = '',
  locationPanelOpen = false,
  locationCandidates = [],
  locationError = '',
  canStrengthenLocation = false,
  selectedLocationName = '',
  onToggleLocation,
  onLocationTextChange,
  onRemoveLocation,
  onSelectLocationCandidate,
  onStrengthenLocation,
  onUseCurrentLocation,
  renderLocationCandidateMeta,

  selectedContact = null,
  contactPanelOpen = false,
  contactCandidates = [],
  contactOptions = [],
  contactSearch = '',
  manualContact = { displayName: '', phone: '', email: '' },
  contactError = '',
  contactPickerSupported = false,
  onOpenContact,
  onCloseContact,
  onRemoveContact,
  onSelectContactCandidate,
  onContactSearchChange,
  onPickNativeContact,
  onManualContactChange,
  onCreateManualContact,
  renderContactCandidateMeta,
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {locationText ? (
          <span className="inline-flex max-w-full items-center rounded bg-emerald-50 text-sm font-medium text-emerald-700" data-review-dismiss-root="location-trigger">
            <button
              type="button"
              onClick={onToggleLocation}
              className="min-w-0 px-2.5 py-1 text-left"
            >
              <span className="block truncate">{locationText}</span>
            </button>
            {onRemoveLocation && (
              <button
                type="button"
                onClick={onRemoveLocation}
                className="px-2 py-1 text-emerald-500"
                aria-label="Remove Location"
              >
                x
              </button>
            )}
          </span>
        ) : (
          <button
            type="button"
            data-review-dismiss-root="location-trigger"
            onClick={onToggleLocation}
            className="inline-flex items-center rounded border border-dashed border-emerald-300 px-2.5 py-1 text-sm text-emerald-700"
          >
            + Location
          </button>
        )}
        {selectedContact ? (
          <button
            type="button"
            data-review-dismiss-root="contact-trigger"
            onClick={onOpenContact}
            className="inline-flex max-w-full items-center rounded bg-violet-50 px-2.5 py-1 text-sm font-medium text-violet-700"
          >
            <span className="truncate">{selectedContact.label || selectedContact.displayName}</span>
          </button>
        ) : (
          <button
            type="button"
            data-review-dismiss-root="contact-trigger"
            onClick={onOpenContact}
            className="inline-flex items-center rounded border border-dashed border-violet-300 px-2.5 py-1 text-sm text-violet-700"
          >
            + Contact
          </button>
        )}
      </div>

      {locationPanelOpen && (
        <div className="mt-3 rounded border border-emerald-100 bg-emerald-50/30 p-3" data-review-dismiss-root="location-panel">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-emerald-900">Location</span>
            <button
              type="button"
              onClick={onToggleLocation}
              className="text-sm text-emerald-700 underline"
            >
              Close
            </button>
          </div>
          <label className="mt-2 block">
            <input
              type="text"
              value={locationText}
              onChange={(event) => onLocationTextChange?.(event.target.value)}
              placeholder="+ Location"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500"
            />
          </label>
          {locationCandidates.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {locationCandidates.map(candidate => (
                <div
                  key={candidate.id}
                  className="shrink-0 rounded border border-emerald-200 bg-white px-2.5 py-1 text-emerald-700"
                >
                  <button
                    type="button"
                    onClick={() => onSelectLocationCandidate?.(candidate)}
                    className="block max-w-56 text-left text-sm font-medium"
                  >
                    <span className="block truncate">{candidate.label || candidate.displayName}</span>
                  </button>
                  {renderLocationCandidateMeta?.(candidate)}
                </div>
              ))}
            </div>
          )}
          {canStrengthenLocation && (
            <div className="mt-2 rounded border border-emerald-100 bg-emerald-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-emerald-900">Are you here now?</p>
                <button
                  type="button"
                  onClick={onStrengthenLocation}
                  className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 transition"
                >
                  Add map pin
                </button>
              </div>
              {selectedLocationName && (
                <p className="mt-1 text-xs text-emerald-700">This will save today&apos;s location to {selectedLocationName} when you confirm.</p>
              )}
            </div>
          )}
          {!locationText && onUseCurrentLocation && (
            <button
              type="button"
              onClick={onUseCurrentLocation}
              className="mt-2 text-sm text-emerald-700 underline"
            >
              Use current location for suggestions
            </button>
          )}
          {locationError && (
            <p className="mt-2 text-sm text-red-700">{locationError}</p>
          )}
        </div>
      )}

      {contactPanelOpen && (
        <div className="mt-3 rounded border border-violet-100 bg-violet-50/30 p-3" data-review-dismiss-root="contact-panel">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-violet-900">Contact</span>
            <button
              type="button"
              onClick={onCloseContact}
              className="text-sm text-violet-700 underline"
            >
              Close
            </button>
          </div>
          {selectedContact && onRemoveContact && (
            <button
              type="button"
              onClick={onRemoveContact}
              className="mt-2 text-sm text-violet-700 underline"
            >
              Remove Contact
            </button>
          )}
          {contactCandidates.length > 0 ? (
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
              {contactCandidates.map(candidate => (
                <div
                  key={candidate.id}
                  className={`shrink-0 rounded border bg-white px-2.5 py-1 ${
                    selectedContact?.id === candidate.id
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectContactCandidate?.(candidate)}
                    className="block max-w-56 text-left text-sm font-medium"
                  >
                    <span className="block truncate">{candidate.label || candidate.displayName}</span>
                  </button>
                  {renderContactCandidateMeta?.(candidate)}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-400">No Contact selected. This is fine if none applies.</p>
          )}
          <div className="mt-3">
            {onContactSearchChange && (
              <>
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(event) => onContactSearchChange(event.target.value)}
                  placeholder="Search saved Contacts"
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                />
                {contactOptions.length > 0 && (
                  <div className="mt-2 max-h-36 overflow-y-auto rounded border border-white bg-white">
                    {contactOptions.map(candidate => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => onSelectContactCandidate?.(candidate)}
                        className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-gray-800 last:border-b-0 hover:bg-violet-50"
                      >
                        <span className="block font-medium">{candidate.label || candidate.displayName}</span>
                        {(candidate.primaryPhone || candidate.primaryEmail) && (
                          <span className="block text-xs text-gray-400">{candidate.primaryPhone || candidate.primaryEmail}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {onPickNativeContact && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onPickNativeContact}
                  disabled={!contactPickerSupported}
                  className="rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-200 disabled:text-gray-500"
                >
                  Pick from phone
                </button>
                {!contactPickerSupported && (
                  <span className="self-center text-xs text-gray-500">Phone picker unavailable here.</span>
                )}
              </div>
            )}

            {onManualContactChange && onCreateManualContact && (
              <div className="mt-3 grid gap-2">
                <input
                  type="text"
                  value={manualContact.displayName || ''}
                  onChange={(event) => onManualContactChange({ ...manualContact, displayName: event.target.value })}
                  placeholder="New Contact name"
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="tel"
                    value={manualContact.phone || ''}
                    onChange={(event) => onManualContactChange({ ...manualContact, phone: event.target.value })}
                    placeholder="Phone"
                    className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                  />
                  <input
                    type="email"
                    value={manualContact.email || ''}
                    onChange={(event) => onManualContactChange({ ...manualContact, email: event.target.value })}
                    placeholder="Email"
                    className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={onCreateManualContact}
                  className="justify-self-start rounded border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700"
                >
                  Create Contact
                </button>
              </div>
            )}
            {contactError && (
              <p className="mt-2 text-sm text-red-700">{contactError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

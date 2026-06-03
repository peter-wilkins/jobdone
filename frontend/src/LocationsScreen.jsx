import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { apiService } from './services/apiService';
import { locationClueService } from './services/locationClueService';
import { chooseLookupLocationAction } from './services/locationLookupService';
import {
  locationNeedsDetail,
  locationMapsUrl,
  locationPrimaryLabel,
  locationSecondaryDetail,
} from './services/locationPresentationService';
import { canStrengthenLocationDraft, strengthenLocationDraftWithClue } from './services/locationStrengtheningService';
import { FloatingRecordButton } from './FloatingRecordButton';

function locationIdFromLocation() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;

  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get('location');
}

export function LocationsScreen({ onBack, onRecord }) {
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(locationIdFromLocation);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [linkedEntries, setLinkedEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [showNeedsDetailOnly, setShowNeedsDetailOnly] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupStatus, setLookupStatus] = useState('idle');
  const [lookupResults, setLookupResults] = useState([]);
  const [proposedLookupCandidate, setProposedLookupCandidate] = useState(null);
  const [detailLookupQuery, setDetailLookupQuery] = useState('');
  const [detailLookupStatus, setDetailLookupStatus] = useState('idle');
  const [detailLookupResults, setDetailLookupResults] = useState([]);
  const [proposedDetailLookupCandidate, setProposedDetailLookupCandidate] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [detailLookupError, setDetailLookupError] = useState(null);
  const [mapPinError, setMapPinError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState(null);

  async function loadLocations() {
    setError(null);
    try {
      const rows = await dbService.getLocations('confirmed');
      setLocations(rows);
    } catch (err) {
      console.error('Failed to load locations:', err);
      setError('Failed to load Locations');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await dbService.getLocations('confirmed');
        if (!cancelled) setLocations(rows);
      } catch (err) {
        console.error('Failed to load locations:', err);
        if (!cancelled) setError('Failed to load Locations');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedLocationId(locationIdFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selectedLocationId) {
        setSelectedLocation(null);
        setLinkedEntries([]);
        return;
      }

      setIsDetailLoading(true);
      setError(null);
      try {
        const [location, entries] = await Promise.all([
          dbService.getLocation(selectedLocationId),
          dbService.getEntriesForLocation(selectedLocationId),
        ]);
        if (!cancelled) {
          setSelectedLocation(location);
          setLinkedEntries(entries);
        }
      } catch (err) {
        console.error('Failed to load location:', err);
        if (!cancelled) setError('Failed to load Location');
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    }

    loadDetail();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const filteredLocations = query.trim()
    ? locations.filter(location => {
        const needle = query.trim().toLowerCase();
        return [
          locationPrimaryLabel(location),
          locationSecondaryDetail(location),
          location.placeText,
          location.addressText,
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
    : locations;
  const visibleLocations = showNeedsDetailOnly
    ? filteredLocations.filter(locationNeedsDetail)
    : filteredLocations;
  const needsDetailCount = locations.filter(locationNeedsDetail).length;

  function selectLocation(locationId) {
    window.history.pushState({ screen: 'locations', locationId }, '', `#locations?location=${encodeURIComponent(locationId)}`);
    setSelectedLocationId(locationId);
  }

  function returnToLocationsList() {
    if (window.history.state?.locationId) {
      window.history.back();
      return;
    }

    window.history.replaceState({ screen: 'locations' }, '', '#locations');
    setSelectedLocationId(null);
  }

  async function handleAddCurrentMapPin(location) {
    if (!canStrengthenLocationDraft(location)) return;

    setIsMutating(true);
    setError(null);
    setMapPinError(null);
    try {
      const result = await locationClueService.captureCurrentLocation({ allowPrompt: true });
      if (!result.ok) {
        setMapPinError('Current location is unavailable right now.');
        return;
      }

      const strengthened = strengthenLocationDraftWithClue(location, result.clue);
      const updated = await dbService.updateLocation(location.id, {
        latitude: strengthened.latitude,
        longitude: strengthened.longitude,
      });
      setSelectedLocation(updated);
      try {
        const result = await syncService.syncLocations([updated]);
        const cloudLocation = result?.locations?.[0];
        if (cloudLocation?.id) {
          await dbService.markLocationSynced(updated.id, cloudLocation.id);
        }
      } catch (syncErr) {
        console.warn('[Locations] Location map pin saved locally but did not sync:', syncErr);
      }
      await loadLocations();
    } catch (err) {
      console.error('Failed to add current map pin:', err);
      setMapPinError('Current location is unavailable right now.');
    } finally {
      setIsMutating(false);
    }
  }

  async function syncLocationIfPossible(location) {
    try {
      const result = await syncService.syncLocations([location]);
      const cloudLocation = result?.locations?.[0];
      if (cloudLocation?.id) {
        return dbService.markLocationSynced(location.id, cloudLocation.id);
      }
    } catch (syncErr) {
      console.warn('[Locations] Location saved locally but did not sync:', syncErr);
    }
    return location;
  }

  async function runAddressLookup(query, setStatus, setResults, setProposal, setLocalError) {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setLocalError('Enter at least 3 characters to search for an address.');
      return;
    }

    setError(null);
    setLocalError(null);
    setStatus('loading');
    setProposal(null);
    try {
      const result = await apiService.lookupLocations(trimmed);
      setResults(result.candidates || []);
      setStatus((result.candidates || []).length ? 'results' : 'empty');
    } catch (err) {
      console.error('Address lookup failed:', err);
      setResults([]);
      setStatus('failed');
      setLocalError('Address search is unavailable right now. Manual approximate Locations still work.');
    }
  }

  async function handleConfirmLookupCandidate(candidate) {
    const decision = chooseLookupLocationAction(locations, candidate);
    if (decision.action === 'invalid') {
      setLookupError('Could not use that address.');
      return;
    }

    if (decision.action === 'reuse') {
      setProposedLookupCandidate(null);
      selectLocation(decision.existing.id);
      return;
    }

    setIsMutating(true);
    setError(null);
    setLookupError(null);
    try {
      const { location } = await dbService.createLocation(decision.draft);
      const synced = await syncLocationIfPossible(location);
      await loadLocations();
      setLookupQuery('');
      setLookupResults([]);
      setLookupStatus('idle');
      setProposedLookupCandidate(null);
      selectLocation(synced.id || location.id);
    } catch (err) {
      console.error('Failed to create Location from lookup:', err);
      setLookupError('Failed to save Location.');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleCreateApproximateLocation() {
    const displayName = lookupQuery.trim();
    if (!displayName) return;

    setIsMutating(true);
    setError(null);
    setLookupError(null);
    try {
      const { location } = await dbService.createLocation({
        displayName,
        placeText: displayName,
        source: 'manual',
      });
      const synced = await syncLocationIfPossible(location);
      await loadLocations();
      setLookupQuery('');
      setLookupResults([]);
      setLookupStatus('idle');
      setProposedLookupCandidate(null);
      selectLocation(synced.id || location.id);
    } catch (err) {
      console.error('Failed to create approximate Location:', err);
      setLookupError('Failed to save Location.');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleConfirmDetailLookupCandidate(location, candidate) {
    if (!location) return;
    const decision = chooseLookupLocationAction(locations.filter(item => item.id !== location.id), candidate);
    if (decision.action === 'invalid') {
      setDetailLookupError('Could not use that address.');
      return;
    }
    if (decision.action === 'reuse') {
      setProposedDetailLookupCandidate(null);
      selectLocation(decision.existing.id);
      return;
    }

    setIsMutating(true);
    setError(null);
    setDetailLookupError(null);
    try {
      const updated = await dbService.updateLocation(location.id, {
        displayName: decision.draft.displayName,
        placeText: decision.draft.placeText,
        addressText: decision.draft.addressText,
        latitude: decision.draft.latitude,
        longitude: decision.draft.longitude,
        providerPlaceId: decision.draft.providerPlaceId,
        lookupEvidence: decision.draft.lookupEvidence,
      });
      const synced = await syncLocationIfPossible(updated);
      setSelectedLocation(synced);
      await loadLocations();
      setDetailLookupQuery('');
      setDetailLookupResults([]);
      setDetailLookupStatus('idle');
      setProposedDetailLookupCandidate(null);
    } catch (err) {
      console.error('Failed to update Location from lookup:', err);
      setDetailLookupError('Failed to update Location.');
    } finally {
      setIsMutating(false);
    }
  }

  if (selectedLocationId) {
    return (
      <LocationDetailScreen
        location={selectedLocation}
        linkedEntries={linkedEntries}
        isLoading={isDetailLoading}
        error={error}
        onBack={returnToLocationsList}
        onRecord={onRecord}
        onAddCurrentMapPin={handleAddCurrentMapPin}
        lookupQuery={detailLookupQuery}
        onLookupQueryChange={setDetailLookupQuery}
        lookupStatus={detailLookupStatus}
        lookupResults={detailLookupResults}
        lookupError={detailLookupError}
        proposedLookupCandidate={proposedDetailLookupCandidate}
        mapPinError={mapPinError}
        onLookup={() => runAddressLookup(detailLookupQuery, setDetailLookupStatus, setDetailLookupResults, setProposedDetailLookupCandidate, setDetailLookupError)}
        onSelectLookupCandidate={setProposedDetailLookupCandidate}
        onConfirmLookupCandidate={handleConfirmDetailLookupCandidate}
        isMutating={isMutating}
      />
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition"
          title="Back"
        >
          ←
        </button>
        <h1 className="text-2xl font-light text-gray-900">Locations</h1>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="px-6 pt-4">
        <AddressLookupPanel
          title="Find address"
          query={lookupQuery}
          onQueryChange={setLookupQuery}
          status={lookupStatus}
          results={lookupResults}
          error={lookupError}
          proposedCandidate={proposedLookupCandidate}
          isMutating={isMutating}
          onLookup={() => runAddressLookup(lookupQuery, setLookupStatus, setLookupResults, setProposedLookupCandidate, setLookupError)}
          onSelectCandidate={setProposedLookupCandidate}
          onConfirmCandidate={() => handleConfirmLookupCandidate(proposedLookupCandidate)}
          onCreateApproximate={handleCreateApproximateLocation}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Locations"
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
        />
        {needsDetailCount > 0 && (
          <div className="mt-3 flex items-center justify-between rounded border border-amber-100 bg-amber-50 px-3 py-2">
            <span className="text-sm text-amber-900">{needsDetailCount} need detail</span>
            <button
              type="button"
              onClick={() => setShowNeedsDetailOnly(value => !value)}
              className="text-sm font-medium text-amber-800 underline decoration-amber-300 underline-offset-4"
            >
              {showNeedsDetailOnly ? 'Show all' : 'Review'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : visibleLocations.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">{query ? 'No matching locations' : 'No locations yet'}</p>
          </div>
        ) : (
          <div className="py-2">
            {visibleLocations.map(location => {
              const mapsUrl = locationMapsUrl(location);
              const needsDetail = locationNeedsDetail(location);
              return (
                <div
                  key={location.id}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition flex items-center gap-3"
                >
                  <button
                    type="button"
                    onClick={() => selectLocation(location.id)}
                    className="flex-1 text-left py-4 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{locationPrimaryLabel(location)}</p>
                      <span className="flex shrink-0 items-center gap-2">
                        {needsDetail && (
                          <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                            Needs detail
                          </span>
                        )}
                        <span className="text-gray-300">›</span>
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {needsDetail ? 'Needs detail' : locationSecondaryDetail(location)}
                    </p>
                  </button>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-gray-500 underline decoration-gray-300 underline-offset-4"
                    >
                      Maps
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}

function LocationDetailScreen({
  location,
  linkedEntries,
  isLoading,
  error,
  onBack,
  onRecord,
  onAddCurrentMapPin,
  lookupQuery,
  onLookupQueryChange,
  lookupStatus,
  lookupResults,
  lookupError,
  proposedLookupCandidate,
  mapPinError,
  onLookup,
  onSelectLookupCandidate,
  onConfirmLookupCandidate,
  isMutating,
}) {
  const mapsUrl = location ? locationMapsUrl(location) : '';
  const needsDetail = location ? locationNeedsDetail(location) : false;
  const canAddMapPin = location ? canStrengthenLocationDraft(location) : false;

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition"
          title="Back"
        >
          ←
        </button>
        <h1 className="text-2xl font-light text-gray-900">Location</h1>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : !location ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Location not found</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-light text-gray-900">{locationPrimaryLabel(location)}</h2>
              <p className="text-sm text-gray-500 mt-2">{locationSecondaryDetail(location)}</p>
              {needsDetail && (
                <div className="mt-4 space-y-4 rounded border border-amber-100 bg-amber-50 px-3 py-3">
                  <p className="text-sm font-medium text-amber-900">Are you here now?</p>
                  <p className="mt-1 text-sm text-amber-800">Add a map pin when you are at this place to make future suggestions better.</p>
                  {canAddMapPin && (
                    <button
                      type="button"
                      onClick={() => onAddCurrentMapPin(location)}
                      disabled={isMutating}
                      className="mt-3 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 transition disabled:opacity-50"
                    >
                        {isMutating ? 'Adding...' : 'Add current map pin'}
                      </button>
                    )}
                    {mapPinError && (
                      <p className="text-sm text-red-700">{mapPinError}</p>
                    )}
                    <div className="border-t border-amber-100 pt-4">
                    <AddressLookupPanel
                      title="Search postcode or address"
                      query={lookupQuery}
                      onQueryChange={onLookupQueryChange}
                        status={lookupStatus}
                        results={lookupResults}
                        error={lookupError}
                        proposedCandidate={proposedLookupCandidate}
                      isMutating={isMutating}
                      tone="amber"
                      onLookup={onLookup}
                      onSelectCandidate={onSelectLookupCandidate}
                      onConfirmCandidate={() => onConfirmLookupCandidate(location, proposedLookupCandidate)}
                    />
                  </div>
                </div>
              )}
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-4 px-3 py-2 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Open in Maps
                </a>
              )}
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">Linked Entries</h3>
              {linkedEntries.length === 0 ? (
                <p className="text-sm text-gray-400">No linked entries</p>
              ) : (
                <div className="space-y-3">
                  {linkedEntries.map(entry => (
                    <div key={entry.id} className="border border-gray-200 rounded p-3">
                      <p className="text-sm font-medium text-gray-900">{entry.summary || 'Untitled entry'}</p>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(entry.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}

function AddressLookupPanel({
  title,
  query,
  onQueryChange,
  status,
  results,
  error,
  proposedCandidate,
  isMutating,
  tone = 'emerald',
  onLookup,
  onSelectCandidate,
  onConfirmCandidate,
  onCreateApproximate,
}) {
  const buttonClass = tone === 'amber'
    ? 'bg-amber-600 hover:bg-amber-700'
    : 'bg-emerald-600 hover:bg-emerald-700';
  const borderClass = tone === 'amber' ? 'border-amber-200' : 'border-emerald-200';
  const textClass = tone === 'amber' ? 'text-amber-800' : 'text-emerald-700';

  return (
    <div className="mb-4 rounded border border-gray-200 bg-white px-3 py-3">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Postcode or address"
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={onLookup}
          disabled={status === 'loading'}
          className={`shrink-0 rounded px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${buttonClass}`}
        >
          {status === 'loading' ? 'Searching...' : 'Search'}
        </button>
      </div>

      {status === 'empty' && (
        <p className="mt-2 text-sm text-gray-500">No address matches found. You can still use a manual approximate Location.</p>
      )}
      {status === 'failed' && (
        <p className="mt-2 text-sm text-gray-500">Address search is unavailable right now. Manual approximate Locations still work.</p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      )}

      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onSelectCandidate(candidate)}
              className={`w-full rounded border px-3 py-2 text-left text-sm transition hover:bg-gray-50 ${
                proposedCandidate?.id === candidate.id ? `${borderClass} ${textClass}` : 'border-gray-200 text-gray-700'
              }`}
            >
              <span className="block font-medium">{candidate.displayName}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{candidate.addressText || candidate.placeText}</span>
            </button>
          ))}
        </div>
      )}

      {proposedCandidate && (
        <div className={`mt-3 rounded border ${borderClass} px-3 py-2`}>
          <p className="text-sm font-medium text-gray-900">Use this Location?</p>
          <p className="mt-1 text-sm text-gray-600">{proposedCandidate.addressText || proposedCandidate.placeText}</p>
          <button
            type="button"
            onClick={onConfirmCandidate}
            disabled={isMutating}
            className={`mt-3 rounded px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${buttonClass}`}
          >
            {isMutating ? 'Saving...' : 'Confirm Location'}
          </button>
        </div>
      )}
      {(status === 'empty' || status === 'failed') && onCreateApproximate && query.trim() && (
        <div className="mt-3">
          <p className="mb-2 truncate text-xs text-gray-500">{query.trim()}</p>
          <button
            type="button"
            onClick={onCreateApproximate}
            disabled={isMutating}
            className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {isMutating ? 'Saving...' : 'Create approximate Location'}
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">Address search powered by OpenStreetMap.</p>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

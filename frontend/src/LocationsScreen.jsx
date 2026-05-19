import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import {
  locationMapsUrl,
  locationPrimaryLabel,
  locationSecondaryDetail,
} from './services/locationPresentationService';

function locationIdFromLocation() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;

  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get('location');
}

export function LocationsScreen({ onBack }) {
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(locationIdFromLocation);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [linkedEntries, setLinkedEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState(null);

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

  if (selectedLocationId) {
    return (
      <LocationDetailScreen
        location={selectedLocation}
        linkedEntries={linkedEntries}
        isLoading={isDetailLoading}
        error={error}
        onBack={returnToLocationsList}
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
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Locations"
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : filteredLocations.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">{query ? 'No matching locations' : 'No locations yet'}</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredLocations.map(location => {
              const mapsUrl = locationMapsUrl(location);
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
                      <span className="text-gray-300">›</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">{locationSecondaryDetail(location)}</p>
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
    </div>
  );
}

function LocationDetailScreen({ location, linkedEntries, isLoading, error, onBack }) {
  const mapsUrl = location ? locationMapsUrl(location) : '';

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

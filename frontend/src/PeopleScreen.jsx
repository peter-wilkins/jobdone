import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { buildContactSummary } from './services/contactParser';

function personIdFromLocation() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;

  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get('person');
}

export function PeopleScreen({ onBack }) {
  const [people, setPeople] = useState([]);
  const [selectedPersonId, setSelectedPersonId] = useState(personIdFromLocation);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [linkedEntries, setLinkedEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState(null);

  async function loadPeople() {
    setError(null);
    try {
      const rows = await dbService.getPeople('confirmed');
      setPeople(rows);
    } catch (err) {
      console.error('Failed to load people:', err);
      setError('Failed to load People');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await dbService.getPeople('confirmed');
        if (!cancelled) setPeople(rows);
      } catch (err) {
        console.error('Failed to load people:', err);
        if (!cancelled) setError('Failed to load People');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedPersonId(personIdFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selectedPersonId) {
        setSelectedPerson(null);
        setLinkedEntries([]);
        return;
      }

      setIsDetailLoading(true);
      setError(null);
      try {
        const [person, entries] = await Promise.all([
          dbService.getPerson(selectedPersonId),
          dbService.getEntriesForPerson(selectedPersonId),
        ]);
        if (!cancelled) {
          setSelectedPerson(person);
          setLinkedEntries(entries);
        }
      } catch (err) {
        console.error('Failed to load person:', err);
        if (!cancelled) setError('Failed to load Person');
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    }

    loadDetail();
    return () => { cancelled = true; };
  }, [selectedPersonId]);

  const filteredPeople = query.trim()
    ? people.filter(person => {
        const needle = query.trim().toLowerCase();
        return [
          person.displayName,
          person.givenName,
          person.familyName,
          person.organization,
          person.title,
          ...(person.emails || []).map(email => email.value),
          ...(person.phones || []).map(phone => phone.value),
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
    : people;

  async function handleDeletePerson() {
    if (!selectedPerson || linkedEntries.length > 0) return;

    setIsMutating(true);
    setError(null);
    try {
      await dbService.deletePerson(selectedPerson.id);
      window.history.replaceState({ screen: 'people' }, '', '#people');
      setSelectedPersonId(null);
      await loadPeople();
    } catch (err) {
      console.error('Failed to delete person:', err);
      setError(err.message || 'Failed to delete Person');
    } finally {
      setIsMutating(false);
    }
  }

  function selectPerson(personId) {
    window.history.pushState({ screen: 'people', personId }, '', `#people?person=${encodeURIComponent(personId)}`);
    setSelectedPersonId(personId);
  }

  function returnToPeopleList() {
    if (window.history.state?.personId) {
      window.history.back();
      return;
    }

    window.history.replaceState({ screen: 'people' }, '', '#people');
    setSelectedPersonId(null);
  }

  if (selectedPersonId) {
    return (
      <PersonDetailScreen
        person={selectedPerson}
        linkedEntries={linkedEntries}
        isLoading={isDetailLoading}
        isMutating={isMutating}
        error={error}
        onBack={returnToPeopleList}
        onDelete={handleDeletePerson}
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
        <h1 className="text-2xl font-light text-gray-900">People</h1>
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
          placeholder="Search People"
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : filteredPeople.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">{query ? 'No matching people' : 'No people yet'}</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredPeople.map(person => (
              <button
                key={person.id}
                type="button"
                onClick={() => selectPerson(person.id)}
                className="w-full text-left py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{person.displayName || 'Untitled person'}</p>
                  <span className="text-gray-300">›</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{buildContactSummary(person)}</p>
                {(person.organization || person.title) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[person.organization, person.title].filter(Boolean).join(' • ')}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonDetailScreen({ person, linkedEntries, isLoading, isMutating, error, onBack, onDelete }) {
  const canDelete = person && linkedEntries.length === 0;

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
        <h1 className="text-2xl font-light text-gray-900">Person</h1>
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
        ) : !person ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Person not found</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-light text-gray-900">{person.displayName || 'Untitled person'}</h2>
              <p className="text-sm text-gray-500 mt-2">{buildContactSummary(person) || 'No contact details'}</p>
              {(person.organization || person.title) && (
                <p className="text-sm text-gray-500 mt-1">
                  {[person.organization, person.title].filter(Boolean).join(' • ')}
                </p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">Contact</h3>
              <div className="space-y-3">
                {(person.phones || []).length === 0 && (person.emails || []).length === 0 ? (
                  <p className="text-sm text-gray-400">No phone or email saved</p>
                ) : (
                  <>
                    {(person.phones || []).map(phone => (
                      <a
                        key={phone.normalized || phone.value}
                        href={`tel:${phone.normalized || phone.value}`}
                        className="block text-sm text-gray-700 underline decoration-gray-300 underline-offset-4"
                      >
                        {phone.value}
                      </a>
                    ))}
                    {(person.emails || []).map(email => (
                      <a
                        key={email.normalized || email.value}
                        href={`mailto:${email.value}`}
                        className="block text-sm text-gray-700 underline decoration-gray-300 underline-offset-4"
                      >
                        {email.value}
                      </a>
                    ))}
                  </>
                )}
              </div>
            </section>

            {person.note && (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">Note</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{person.note}</p>
              </section>
            )}

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

            <section className="border-t border-gray-100 pt-5">
              {canDelete ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isMutating}
                  className="w-full px-4 py-2 border border-red-200 text-red-700 text-sm font-medium rounded hover:bg-red-50 transition disabled:opacity-50"
                >
                  {isMutating ? 'Deleting...' : 'Delete Person'}
                </button>
              ) : (
                <p className="text-sm text-gray-400">
                  People linked to Entries cannot be deleted.
                </p>
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

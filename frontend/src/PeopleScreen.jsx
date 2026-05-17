import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { buildContactSummary } from './services/contactParser';

export function PeopleScreen({ onBack }) {
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPeople() {
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

    loadPeople();
    return () => { cancelled = true; };
  }, []);

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
              <div key={person.id} className="py-4 border-b border-gray-100 last:border-b-0">
                <p className="text-sm font-medium text-gray-900">{person.displayName || 'Untitled person'}</p>
                <p className="text-xs text-gray-500 mt-1">{buildContactSummary(person)}</p>
                {(person.organization || person.title) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[person.organization, person.title].filter(Boolean).join(' • ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

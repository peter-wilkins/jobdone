import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { buildContactSummary } from './services/contactParser';
import { FloatingRecordButton } from './FloatingRecordButton';

function contactIdFromLocation() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;

  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get('contact') || params.get('person');
}

export function ContactsScreen({ onBack, onRecord }) {
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState(contactIdFromLocation);
  const [selectedContact, setSelectedContact] = useState(null);
  const [linkedEntries, setLinkedEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState(null);

  async function loadContacts() {
    setError(null);
    try {
      const rows = await dbService.getContacts('confirmed');
      setContacts(rows);
    } catch (err) {
      console.error('Failed to load contacts:', err);
      setError('Failed to load Contacts');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await dbService.getContacts('confirmed');
        if (!cancelled) setContacts(rows);
      } catch (err) {
        console.error('Failed to load contacts:', err);
        if (!cancelled) setError('Failed to load Contacts');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedContactId(contactIdFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selectedContactId) {
        setSelectedContact(null);
        setLinkedEntries([]);
        return;
      }

      setIsDetailLoading(true);
      setError(null);
      try {
        const [contact, entries] = await Promise.all([
          dbService.getContact(selectedContactId),
          dbService.getEntriesForContact(selectedContactId),
        ]);
        if (!cancelled) {
          setSelectedContact(contact);
          setLinkedEntries(entries);
        }
      } catch (err) {
        console.error('Failed to load contact:', err);
        if (!cancelled) setError('Failed to load Contact');
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    }

    loadDetail();
    return () => { cancelled = true; };
  }, [selectedContactId]);

  const filteredContacts = query.trim()
    ? contacts.filter(contact => {
        const needle = query.trim().toLowerCase();
        return [
          contact.displayName,
          contact.givenName,
          contact.familyName,
          contact.organization,
          contact.title,
          ...(contact.emails || []).map(email => email.value),
          ...(contact.phones || []).map(phone => phone.value),
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
    : contacts;

  async function handleDeleteContact() {
    if (!selectedContact || linkedEntries.length > 0) return;

    setIsMutating(true);
    setError(null);
    try {
      await dbService.deleteContact(selectedContact.id);
      window.history.replaceState({ screen: 'contacts' }, '', '#contacts');
      setSelectedContactId(null);
      await loadContacts();
    } catch (err) {
      console.error('Failed to delete contact:', err);
      setError(err.message || 'Failed to delete Contact');
    } finally {
      setIsMutating(false);
    }
  }

  function selectContact(contactId) {
    window.history.pushState({ screen: 'contacts', contactId }, '', `#contacts?contact=${encodeURIComponent(contactId)}`);
    setSelectedContactId(contactId);
  }

  function returnToContactsList() {
    if (window.history.state?.contactId || window.history.state?.personId) {
      window.history.back();
      return;
    }

    window.history.replaceState({ screen: 'contacts' }, '', '#contacts');
    setSelectedContactId(null);
  }

  if (selectedContactId) {
    return (
      <ContactDetailScreen
        contact={selectedContact}
        linkedEntries={linkedEntries}
        isLoading={isDetailLoading}
        isMutating={isMutating}
        error={error}
        onBack={returnToContactsList}
        onRecord={onRecord}
        onDelete={handleDeleteContact}
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
        <h1 className="text-2xl font-light text-gray-900">Contacts</h1>
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
          placeholder="Search Contacts"
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">{query ? 'No matching contacts' : 'No contacts yet'}</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredContacts.map(contact => (
              <button
                key={contact.id}
                type="button"
                onClick={() => selectContact(contact.id)}
                className="w-full text-left py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{contact.displayName || 'Untitled contact'}</p>
                  <span className="text-gray-300">›</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{buildContactSummary(contact)}</p>
                {(contact.organization || contact.title) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[contact.organization, contact.title].filter(Boolean).join(' • ')}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}

function ContactDetailScreen({ contact, linkedEntries, isLoading, isMutating, error, onBack, onRecord, onDelete }) {
  const canDelete = contact && linkedEntries.length === 0;

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
        <h1 className="text-2xl font-light text-gray-900">Contact</h1>
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
        ) : !contact ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Contact not found</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-light text-gray-900">{contact.displayName || 'Untitled contact'}</h2>
              <p className="text-sm text-gray-500 mt-2">{buildContactSummary(contact) || 'No contact details'}</p>
              {(contact.organization || contact.title) && (
                <p className="text-sm text-gray-500 mt-1">
                  {[contact.organization, contact.title].filter(Boolean).join(' • ')}
                </p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">Contact</h3>
              <div className="space-y-3">
                {(contact.phones || []).length === 0 && (contact.emails || []).length === 0 ? (
                  <p className="text-sm text-gray-400">No phone or email saved</p>
                ) : (
                  <>
                    {(contact.phones || []).map(phone => (
                      <a
                        key={phone.normalized || phone.value}
                        href={`tel:${phone.normalized || phone.value}`}
                        className="block text-sm text-gray-700 underline decoration-gray-300 underline-offset-4"
                      >
                        {phone.value}
                      </a>
                    ))}
                    {(contact.emails || []).map(email => (
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

            {contact.note && (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-3">Note</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.note}</p>
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
                  {isMutating ? 'Deleting...' : 'Delete Contact'}
                </button>
              ) : (
                <p className="text-sm text-gray-400">
                  Contacts linked to Entries cannot be deleted.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
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

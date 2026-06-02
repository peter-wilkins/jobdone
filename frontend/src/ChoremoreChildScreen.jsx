import { useEffect, useState } from 'react';
import { apiService } from './services/apiService';
import { ProductSwitcher } from './ProductSwitcher';

function statusLabel(status) {
  if (status === 'needs_more_evidence') return 'Needs more evidence';
  if (status === 'submitted') return 'Submitted';
  if (status === 'claimed') return 'Claimed';
  if (status === 'approved') return 'Approved';
  return status;
}

function ItemSummary({ item }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
      <p className="mt-1 text-xs text-gray-500">{item.points} point{item.points === 1 ? '' : 's'}</p>
    </div>
  );
}

function ClaimedItem({ item, evidenceText, onEvidenceChange, onSubmit, busy }) {
  const canSubmit = item.status === 'claimed' || item.status === 'needs_more_evidence';
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <ItemSummary item={item} />
        <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
          {statusLabel(item.status)}
        </span>
      </div>
      {canSubmit ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={evidenceText || ''}
            onChange={(event) => onEvidenceChange(item.id, event.target.value)}
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            placeholder="What did you do?"
          />
          <button
            type="button"
            disabled={busy || !(evidenceText || '').trim()}
            onClick={() => onSubmit(item)}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Submit for approval
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500">Waiting for approval.</p>
      )}
    </div>
  );
}

function OpenBacklogItem({ item, onClaim, busy }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <ItemSummary item={item} />
        <button
          type="button"
          disabled={busy}
          onClick={() => onClaim(item)}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          Claim
        </button>
      </div>
    </div>
  );
}

export function ChoremoreChildScreen({ onBack, onNavigate }) {
  const [claimedItems, setClaimedItems] = useState([]);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [approvedThisWeek, setApprovedThisWeek] = useState([]);
  const [weeklyPoints, setWeeklyPoints] = useState(0);
  const [evidenceByItemId, setEvidenceByItemId] = useState({});
  const [busyItemId, setBusyItemId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadChildState() {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getChoremoreChildState();
      setClaimedItems(state.claimedItems || []);
      setOpenBacklogItems(state.openBacklogItems || []);
      setApprovedThisWeek(state.approvedThisWeek || []);
      setWeeklyPoints(state.weeklyPoints || 0);
    } catch (err) {
      setError(err.message || 'Could not load Choremore');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Initial screen load is the synchronization point for child work state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChildState();
  }, []);

  const claimItem = async (item) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      await apiService.claimChoremoreBacklogItem(item.id);
      await loadChildState();
    } catch (err) {
      setError(err.message || 'Could not claim Backlog Item');
    } finally {
      setBusyItemId(null);
    }
  };

  const submitEvidence = async (item) => {
    const evidenceText = evidenceByItemId[item.id] || '';
    setBusyItemId(item.id);
    setError(null);
    try {
      await apiService.submitChoremoreEvidence(item.id, evidenceText);
      setEvidenceByItemId(prev => ({ ...prev, [item.id]: '' }));
      await loadChildState();
    } catch (err) {
      setError(err.message || 'Could not submit evidence');
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 px-4 py-3 flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700"
          title="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-light text-gray-900 leading-5">Choremore</h1>
          <p className="text-xs text-gray-500">Child backlog</p>
          <ProductSwitcher currentProduct="choremore" onSwitch={onNavigate} />
        </div>
        <button
          type="button"
          onClick={() => onNavigate('choremore-parent')}
          className="mt-1 shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
        >
          Parent
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Claimed</h2>
                <span className="text-xs text-gray-400">{claimedItems.length}</span>
              </div>
              {claimedItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">Nothing claimed.</p>
              ) : (
                <div>
                  {claimedItems.map(item => (
                    <ClaimedItem
                      key={item.id}
                      item={item}
                      evidenceText={evidenceByItemId[item.id] || ''}
                      busy={busyItemId === item.id}
                      onEvidenceChange={(itemId, value) => setEvidenceByItemId(prev => ({ ...prev, [itemId]: value }))}
                      onSubmit={submitEvidence}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Backlog</h2>
                <span className="text-xs text-gray-400">{openBacklogItems.length}</span>
              </div>
              {openBacklogItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No open Backlog Items.</p>
              ) : (
                <div>
                  {openBacklogItems.map(item => (
                    <OpenBacklogItem
                      key={item.id}
                      item={item}
                      busy={busyItemId === item.id}
                      onClaim={claimItem}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Approved This Week</h2>
                <span className="text-xs font-medium text-gray-700">{weeklyPoints} point{weeklyPoints === 1 ? '' : 's'}</span>
              </div>
              {approvedThisWeek.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No approved work this week.</p>
              ) : (
                <div>
                  {approvedThisWeek.map(item => (
                    <div key={item.id} className="py-3 border-b border-gray-100 last:border-b-0">
                      <ItemSummary item={item} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

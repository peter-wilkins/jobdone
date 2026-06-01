import { useEffect, useState } from 'react';
import { apiService } from './services/apiService';
import { ProductSwitcher } from './ProductSwitcher';

const EMPTY_FORM = { description: '', points: 3 };

function pointsOptions() {
  return Array.from({ length: 10 }, (_, index) => index + 1);
}

function BacklogItemRow({ item, onEdit, onDelete }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          <p className="mt-1 text-xs text-gray-500">{item.points} point{item.points === 1 ? '' : 's'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalRequestRow({ request, onDecision, busy }) {
  const item = request.backlog_item || {};
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description || 'Submitted work'}</p>
      <p className="mt-1 text-xs text-gray-500">
        {item.points || 0} point{item.points === 1 ? '' : 's'} · Submitted for approval
      </p>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(request, 'needs_more_evidence')}
          className="px-3 py-2 text-sm font-medium text-amber-800 border border-amber-200 rounded hover:bg-amber-50 disabled:opacity-50"
        >
          Needs more evidence
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(request, 'approved')}
          className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

export function ChoremoreParentScreen({ onBack, onNavigate }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [submittedApprovalRequests, setSubmittedApprovalRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [error, setError] = useState(null);

  async function loadParentState() {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getChoremoreParentState();
      setOpenBacklogItems(state.openBacklogItems || []);
      setSubmittedApprovalRequests(state.submittedApprovalRequests || []);
    } catch (err) {
      setError(err.message || 'Could not load Choremore');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Initial screen load is the synchronization point for parent backlog state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadParentState();
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveBacklogItem = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await apiService.updateChoremoreBacklogItem(editingId, form);
      } else {
        await apiService.createChoremoreBacklogItem(form);
      }
      resetForm();
      await loadParentState();
    } catch (err) {
      setError(err.message || 'Could not save Backlog Item');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setForm({ description: item.description || '', points: item.points || 3 });
  };

  const deleteItem = async (item) => {
    setError(null);
    try {
      await apiService.deleteChoremoreBacklogItem(item.id);
      await loadParentState();
    } catch (err) {
      setError(err.message || 'Could not delete Backlog Item');
    }
  };

  const decideApproval = async (request, decision) => {
    setBusyApprovalId(request.id);
    setError(null);
    try {
      await apiService.decideChoremoreApprovalRequest(request.id, decision);
      await loadParentState();
    } catch (err) {
      setError(err.message || 'Could not update Approval Request');
    } finally {
      setBusyApprovalId(null);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700"
          title="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-light text-gray-900 leading-5">Choremore</h1>
          <p className="text-xs text-gray-500">Parent backlog</p>
          <ProductSwitcher currentProduct="choremore" onSwitch={onNavigate} />
        </div>
        <button
          type="button"
          onClick={() => onNavigate('choremore-child')}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
        >
          Child
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <form onSubmit={saveBacklogItem} className="space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
              Backlog item
            </label>
            <textarea
              value={form.description}
              onChange={(event) => setForm(prev => ({ ...prev, description: event.target.value }))}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              placeholder="What needs doing?"
            />
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                Points
              </label>
              <select
                value={form.points}
                onChange={(event) => setForm(prev => ({ ...prev, points: Number(event.target.value) }))}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              >
                {pointsOptions().map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={isSaving || !form.description.trim()}
              className="flex-1 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {editingId ? 'Save changes' : 'Add to backlog'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Open Backlog Items</h2>
                <span className="text-xs text-gray-400">{openBacklogItems.length}</span>
              </div>
              {openBacklogItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No open Backlog Items.</p>
              ) : (
                <div>
                  {openBacklogItems.map(item => (
                    <BacklogItemRow
                      key={item.id}
                      item={item}
                      onEdit={startEditing}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Submitted For Approval</h2>
                <span className="text-xs text-gray-400">{submittedApprovalRequests.length}</span>
              </div>
              {submittedApprovalRequests.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No work waiting for approval.</p>
              ) : (
                <div>
                  {submittedApprovalRequests.map(request => (
                    <ApprovalRequestRow
                      key={request.id}
                      request={request}
                      busy={busyApprovalId === request.id}
                      onDecision={decideApproval}
                    />
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

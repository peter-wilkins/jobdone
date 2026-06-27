export function Modal({
  open,
  title,
  description = '',
  onClose,
  children,
  closeLabel = 'Close',
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex items-end bg-black/35 p-2 sm:items-center sm:justify-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
        className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="app-modal-title" className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 px-2.5 py-1 text-sm font-medium text-gray-600"
            aria-label={closeLabel}
          >
            {closeLabel}
          </button>
        </div>
        <div className="mt-3">
          {children}
        </div>
      </section>
    </div>
  );
}

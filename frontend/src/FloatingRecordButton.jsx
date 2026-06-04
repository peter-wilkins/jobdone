export function FloatingRecordButton({ onRecord }) {
  return (
    <button
      type="button"
      onClick={onRecord}
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gray-300 text-white shadow-lg transition hover:opacity-90"
      title="New entry"
      aria-label="New entry"
    >
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

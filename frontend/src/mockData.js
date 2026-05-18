export const mockInProgressEntries = [
  {
    id: 'ip-1',
    status: 'ready_for_review',
    transcript: "Fixed the leaky tap under the sink. Replaced the valve cartridge. Took about 30 minutes. Customer asked about the bathroom radiator while I was there.",
    summary: "Replaced tap valve cartridge under kitchen sink.",
    created_at: new Date(Date.now() - 5 * 60000),
  }
];

export const mockSavedEntries = [
  {
    id: 'saved-1',
    status: 'confirmed',
    transcript: "Attended the Henderson property. Their kitchen tap has been dripping for weeks. Replaced the entire mixing valve assembly. Used compression fittings and silicone grease. Took about an hour and a half. They mentioned wanting to redo the whole kitchen eventually.",
    summary: "Replaced kitchen mixing valve at Henderson's. Full assembly replacement.",
    created_at: new Date(Date.now() - 24 * 60 * 60000),
  },
  {
    id: 'saved-2',
    status: 'confirmed',
    transcript: "Quick callout to the Smiths. Their toilet cistern wasn't filling properly. Replaced the fill valve with a new ballcock. Very straightforward job, maybe 15 minutes including cleanup.",
    summary: "Replaced toilet cistern fill valve.",
    created_at: new Date(Date.now() - 48 * 60 * 60000),
  },
  {
    id: 'saved-3',
    status: 'confirmed',
    transcript: "Emergency call at the office building. Burst pipe in the second floor bathroom. Patched it temporarily with epoxy putty and shutoff valve. Advised them to call for permanent fix next week. Also spotted rust on the main line, should replace.",
    summary: "Temporary burst pipe repair at office. Permanent replacement recommended.",
    created_at: new Date(Date.now() - 72 * 60 * 60000),
  },
];

export function formatTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function selectTeamTimelineEntries(entries = [], teamId = null, teamName = '') {
  const normalizedTeamName = String(teamName || '').trim().toLowerCase();
  return (entries || []).filter(entry => {
    const contexts = Array.isArray(entry.workContexts) ? entry.workContexts : [];
    return contexts.some(context => {
      const contextTeamId = context?.teamId || context?.team_id || context?.team?.id || null;
      if (teamId && contextTeamId === teamId) return true;
      const contextTeamName = String(context?.teamName || context?.team?.name || '').trim().toLowerCase();
      return Boolean(normalizedTeamName && contextTeamName === normalizedTeamName);
    });
  });
}


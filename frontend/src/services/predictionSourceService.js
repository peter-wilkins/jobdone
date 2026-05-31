function sentence(value) {
  return String(value || '').trim();
}

function counterpartLabel(candidate) {
  return sentence(candidate?.matchedCounterpart?.label);
}

function priorUseCount(candidate) {
  const count = Number(candidate?.coOccurrenceCount || candidate?.stats?.useCount || 0);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function usedBeforeText(candidate, fallback) {
  const count = priorUseCount(candidate);
  if (count && count > 1) return `Used ${count} times before`;
  return fallback;
}

const SOURCE_COPY = {
  device_location: {
    hint: 'Current location',
    explanation:
      'Suggested from your device location at capture time. JobDone only saves it if you confirm it.',
  },
  context_clue: {
    hint: 'Capture clue',
    explanation:
      'Suggested from a visible clue attached to this Capture, such as shared data or review context.',
  },
  location_history: {
    hint: 'Saved Location',
    explanation:
      'Suggested from your saved Locations because it appears to match the reviewed Entry text or recent use.',
  },
  contact_history: {
    hint: 'Saved Contact',
    explanation:
      'Suggested from your saved Contacts because the reviewed Entry text appears to mention this Contact.',
  },
  local_contacts: {
    hint: 'Saved Contact',
    explanation:
      'Suggested from Contacts stored on this device because the reviewed Entry text appears to mention this Contact.',
  },
  tag_vocabulary: {
    hint: 'Prior Tag',
    explanation:
      'Suggested from Tags you have used before. JobDone does not use hidden raw history here.',
  },
  domain_template: {
    hint: 'Common Tag',
    explanation:
      'Suggested from JobDone built-in work tags because the reviewed Entry text fits this kind of work.',
  },
};

export function predictionSourcePresentation(candidate = {}, kind = 'suggestion') {
  if (candidate.source === 'co_occurrence') {
    const other = counterpartLabel(candidate);
    const kindLabel = kind === 'contact' ? 'Contact' : 'Location';
    return {
      hint: usedBeforeText(candidate, 'Used before'),
      explanation: other
        ? `Suggested because this ${kindLabel} has been confirmed with ${other} before.`
        : `Suggested because this ${kindLabel} has been confirmed with related review choices before.`,
    };
  }

  const copy = SOURCE_COPY[candidate.source] || {
    hint: 'Suggestion',
    explanation:
      'Suggested from available review clues. Confirm it only if it matches what you meant.',
  };

  return {
    hint: copy.hint,
    explanation: copy.explanation,
  };
}

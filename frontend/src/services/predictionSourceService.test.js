import assert from 'node:assert/strict';
import test from 'node:test';
import { predictionSourcePresentation } from './predictionSourceService.js';

test('shows safe Location source hint and explanation for device location', () => {
  const presentation = predictionSourcePresentation({
    source: 'device_location',
    label: 'Current location',
    latitude: 53.1,
    longitude: -6.2,
  }, 'location');

  assert.equal(presentation.hint, 'Current location');
  assert.match(presentation.explanation, /device location at capture time/);
  assert.doesNotMatch(presentation.explanation, /53\.1|-6\.2/);
});

test('shows safe Contact source hint and explanation for local contacts', () => {
  const presentation = predictionSourcePresentation({
    source: 'local_contacts',
    label: 'Sarah Jenkins',
    primaryPhone: '07123 456789',
  }, 'contact');

  assert.equal(presentation.hint, 'Saved Contact');
  assert.match(presentation.explanation, /Contacts stored on this device/);
  assert.doesNotMatch(presentation.explanation, /07123/);
});

test('shows Tag vocabulary hint without exposing raw history', () => {
  const presentation = predictionSourcePresentation({
    source: 'tag_vocabulary',
    label: 'Boiler Service',
    stats: { useCount: 4 },
  }, 'tag');

  assert.equal(presentation.hint, 'Prior Tag');
  assert.match(presentation.explanation, /Tags you have used before/);
  assert.match(presentation.explanation, /does not use hidden raw history/);
});

test('explains co-occurrence suggestions from the visible counterpart only', () => {
  const presentation = predictionSourcePresentation({
    source: 'co_occurrence',
    label: '14 Bell Street',
    coOccurrenceCount: 3,
    matchedCounterpart: {
      kind: 'contact',
      id: 'contact-1',
      label: 'Sarah Jenkins',
    },
  }, 'location');

  assert.equal(presentation.hint, 'Used 3 times before');
  assert.equal(
    presentation.explanation,
    'Suggested because this Location has been confirmed with Sarah Jenkins before.'
  );
});

test('explains deterministic pre-extraction suggestions', () => {
  const presentation = predictionSourcePresentation({
    source: 'deterministic_pre_extraction',
  });

  assert.equal(presentation.hint, 'Text match');
  assert.match(presentation.explanation, /reviewed Entry text/);
});

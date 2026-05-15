/**
 * Mock API responses for testing
 */

export const mockTranscripts = [
  "Fixed the kitchen tap at the Smith place, used a 15mm compression fitting, took about 45 minutes, they want the bathroom looked at next week",
  "Emergency burst pipe repair at the office building, patched it temporarily with epoxy putty, advised them to call for permanent fix next week, also spotted rust on the main line should replace",
  "Replaced the toilet cistern fill valve, very straightforward job, took maybe 15 minutes including cleanup, used a new ballcock valve",
  "Attended Henderson property, their kitchen tap has been dripping for weeks, replaced the entire mixing valve assembly, used compression fittings and silicone grease, took about 90 minutes",
];

export const mockResults = {
  0: {
    summary: "Replaced tap valve at the Smith place. 15mm fitting, 45 minutes. Bathroom inspection follow-up.",
    materials: ["15mm compression fitting"],
    labour_minutes: 45,
    follow_ups: ["bathroom inspection"],
    possible_future_work: "",
  },
  1: {
    summary: "Emergency burst pipe repair at office building. Temporary epoxy patch, advised permanent replacement needed next week.",
    materials: ["epoxy putty", "shutoff valve"],
    labour_minutes: 45,
    follow_ups: ["Permanent pipe replacement next week"],
    possible_future_work: "Replace main line due to rust",
  },
  2: {
    summary: "Replaced toilet cistern fill valve. Quick 15-minute job, used new ballcock valve.",
    materials: ["ballcock valve"],
    labour_minutes: 15,
    follow_ups: [],
    possible_future_work: "",
  },
  3: {
    summary: "Replaced kitchen mixing valve assembly at Henderson's. Full assembly replacement with compression fittings.",
    materials: ["mixing valve assembly", "compression fittings", "15mm connectors", "silicone grease"],
    labour_minutes: 90,
    follow_ups: [],
    possible_future_work: "Full kitchen refit discussion",
  },
};

/**
 * Get a random mock transcript and result
 */
export function getRandomMockResult() {
  const index = Math.floor(Math.random() * mockTranscripts.length);
  const transcript = mockTranscripts[index];
  const result = mockResults[index];

  return {
    transcript,
    summary: result.summary,
    materials: result.materials,
    labour_minutes: result.labour_minutes,
    follow_ups: result.follow_ups,
    possible_future_work: result.possible_future_work,
  };
}

/**
 * Mock Whisper transcription
 */
export async function mockTranscribeAudio() {
  console.log('[Mock] Whisper transcription (mock)');
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
  
  const index = Math.floor(Math.random() * mockTranscripts.length);
  return {
    transcript: mockTranscripts[index],
    language: 'en',
  };
}

/**
 * Mock Claude summarization
 */
export async function mockSummarizeAndExtract(transcript) {
  console.log('[Mock] Claude summarization (mock)');
  await new Promise(resolve => setTimeout(resolve, 800)); // Simulate delay
  
  // Find matching result or return first one
  const index = mockTranscripts.findIndex(t => t === transcript);
  const result = mockResults[index >= 0 ? index : 0];

  return {
    summary: result.summary,
    materials: result.materials,
    labour_minutes: result.labour_minutes,
    follow_ups: result.follow_ups,
    possible_future_work: result.possible_future_work,
  };
}

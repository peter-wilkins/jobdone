/**
 * Mock API responses for testing
 * Queries (Recall questions) that match customer identities from populate-db.js script
 * Users ask these questions to filter their Timeline of Entries
 * 
 * Feature flag: MOCK_RETURN_QUERIES
 *   true  → mockTranscribeAudio() returns queries (for Recall testing)
 *   false → mockTranscribeAudio() returns entries (for Capture testing, default)
 */

const MOCK_RETURN_QUERIES = process.env.MOCK_RETURN_QUERIES === 'true';

export const mockQueries = [
  "What did I do at Mrs Smith's place on Oak Street?",
  "Have I worked at the Jones office building before?",
  "Show me tap replacements at Henderson's",
  "When was I last at Ivy Lane for Henderson?",
  "What emergency calls have I done at London Tower?",
  "Show me recent maintenance work at Park View Estate",
  "What work did I do at Riverside Hotel?",
  "Have I been to Parkside Retail Centre?",
  "Show me school plumbing jobs at Crown School",
  "What work did I do at Medway Dental?",
  "Farm plumbing jobs at Greenfield Farm",
  "Show me all radiator work",
  "What pipes have I replaced?",
  "Did I do any emergency work last week?",
  "Show me kitchen work from last month",
  "How many times have I visited the Smith place?",
  "What commercial jobs have I done?",
  "Show me jobs over 90 minutes",
  "Tap and valve repairs in Croydon",
  "What future work is recommended at Smith's?",
];

/**
 * Get a random mock query
 */
export function getRandomMockQuery() {
  return mockQueries[Math.floor(Math.random() * mockQueries.length)];
}

// ---------------------------------------------------------------------------
// Entry transcripts and summaries (for Capture flow)
// ---------------------------------------------------------------------------

const entryTranscripts = [
  "Fixed the kitchen tap at Mrs Smith's place on 42 Oak Street, Croydon, used a 15mm compression fitting, took about 45 minutes, they want the bathroom looked at next week",
  "Emergency burst pipe repair at Jones & Co office building on Business Park, patched it temporarily with epoxy putty, advised them to call for permanent fix next week, also spotted rust on the main line should replace",
  "Replaced the toilet cistern fill valve at Henderson's on Ivy Lane, very straightforward job, took 15 minutes, used a new ballcock valve",
  "Kitchen tap replacement at Henderson's, their tap has been dripping for weeks, replaced the entire mixing valve assembly, used compression fittings and silicone grease, took about 90 minutes",
  "Main line emergency at London Tower Building on High Street, temporary patch with epoxy, water pressure tested, customer satisfied",
  "Preventative maintenance at Park View Estate, flushed system, checked all valves, replaced worn washers, took 45 minutes",
  "Guest room plumbing at Riverside Hotel, fixed leaking bathroom tap, installed new mixing valve, took about 30 minutes",
  "Restroom maintenance at Parkside Retail Centre, repaired waste pipe blockage, system tested and cleared, preventative advice given",
  "School bathroom maintenance at Crown School on Crown Road, shower block upgrade, new thermostatic valve installed, took 60 minutes",
  "Sterilisation system check at Medway Dental surgery, hand basin upgrade, water quality issue resolved, temporary supply while permanent fix arranged",
  "Farm plumbing at Greenfield Farm, external main line repair, water tank service completed, feeding system checked, took about 2 hours",
];

const entrySummaries = {
  0: {
    summary: "Fixed kitchen tap at Mrs Smith's on 42 Oak Street, Croydon. 15mm fitting, 45 minutes. Bathroom inspection follow-up.",
    materials: ["15mm compression fitting"],
    labour_minutes: 45,
    follow_ups: ["Bathroom inspection needed"],
    possible_future_work: "",
  },
  1: {
    summary: "Emergency burst pipe repair at Jones & Co office. Temporary epoxy patch, permanent replacement advised.",
    materials: ["epoxy putty", "shutoff valve"],
    labour_minutes: 45,
    follow_ups: ["Permanent pipe replacement next week"],
    possible_future_work: "Replace main line due to rust",
  },
  2: {
    summary: "Replaced toilet cistern fill valve at Henderson's on Ivy Lane. 15-minute job, new ballcock valve installed.",
    materials: ["ballcock valve"],
    labour_minutes: 15,
    follow_ups: [],
    possible_future_work: "",
  },
  3: {
    summary: "Kitchen tap replacement at Henderson's. Full mixing valve assembly swap with compression fittings, 90 minutes.",
    materials: ["mixing valve assembly", "compression fittings", "15mm connectors", "silicone grease"],
    labour_minutes: 90,
    follow_ups: [],
    possible_future_work: "Full kitchen refit discussion",
  },
  4: {
    summary: "Emergency main line repair at London Tower Building. Temporary epoxy patch, pressure tested and commissioned.",
    materials: ["epoxy putty", "compression joint"],
    labour_minutes: 35,
    follow_ups: ["Permanent repair coordination"],
    possible_future_work: "Permanent pipe replacement",
  },
  5: {
    summary: "Preventative maintenance at Park View Estate. System flush, valve check, washers replaced, 45 minutes.",
    materials: ["replacement washers", "O-rings", "lubricating oil"],
    labour_minutes: 45,
    follow_ups: [],
    possible_future_work: "",
  },
  6: {
    summary: "Guest room plumbing at Riverside Hotel. Leaking tap fixed, new mixing valve installed, 30 minutes.",
    materials: ["mixing valve", "compression fitting", "silicone sealant"],
    labour_minutes: 30,
    follow_ups: [],
    possible_future_work: "Check other guest bathrooms",
  },
  7: {
    summary: "Restroom maintenance at Parkside Retail Centre. Waste pipe blockage cleared, system tested.",
    materials: ["pipe cleaner", "new seal"],
    labour_minutes: 25,
    follow_ups: [],
    possible_future_work: "Regular maintenance schedule",
  },
  8: {
    summary: "School bathroom maintenance at Crown School. Shower block upgrade with thermostatic valve, 60 minutes.",
    materials: ["thermostatic valve", "mixing cartridge", "compression fittings"],
    labour_minutes: 60,
    follow_ups: [],
    possible_future_work: "Staff training on temperature control",
  },
  9: {
    summary: "Dental surgery plumbing at Medway Dental. Hand basin upgrade, water quality issue fixed.",
    materials: ["basin mixer", "filter cartridge", "new inlet hose"],
    labour_minutes: 40,
    follow_ups: ["Permanent water supply arrangement"],
    possible_future_work: "Permanent sterilisation system upgrade",
  },
  10: {
    summary: "Farm plumbing at Greenfield Farm. Main line repair, water tank service, feeding system checked, 120 minutes.",
    materials: ["pipe sections", "compression fittings", "epoxy putty"],
    labour_minutes: 120,
    follow_ups: [],
    possible_future_work: "Pressure regulator upgrade discussion",
  },
};

/**
 * Mock Whisper transcription
 * 
 * Feature flag MOCK_RETURN_QUERIES controls what type of transcript is returned:
 * - true: returns QUERY transcripts (recall questions) → intent: 'QUERY'
 * - false: returns NOTE transcripts (entry captures) → intent: 'NOTE' (default)
 */
export async function mockTranscribeAudio() {
  console.log('[Mock] Whisper transcription (mock)');
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
  
  let transcript;
  
  if (MOCK_RETURN_QUERIES) {
    // Return a query (recall question)
    const index = Math.floor(Math.random() * mockQueries.length);
    transcript = mockQueries[index];
  } else {
    // Return an entry (capture note)
    const index = Math.floor(Math.random() * entryTranscripts.length);
    transcript = entryTranscripts[index];
  }
  
  return {
    transcript,
    language: 'en',
  };
}

/**
 * Mock Claude summarization (passthrough)
 * Returns transcript as-is without extraction — real Claude API does the work
 */
export async function mockSummarizeAndExtract(transcript) {
  console.log('[Mock] Claude summarization (mock)');
  await new Promise(resolve => setTimeout(resolve, 800)); // Simulate delay
  
  return {
    summary: transcript,
    materials: [],
    labour_minutes: null,
    follow_ups: [],
    possible_future_work: '',
  };
}

/**
 * Mock OpenAI embeddings
 */
export async function mockEmbedText(text) {
  console.log('[Mock] Voyage AI embeddings (mock)');
  await new Promise(resolve => setTimeout(resolve, 200)); // Simulate delay
  
  // Generate deterministic 1024-dim vector from text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  const seed = Math.abs(hash) / 2147483647; // Normalize to 0-1
  const vector = Array.from({ length: 1024 }, (_, i) => {
    const pseudo = Math.sin((i + seed) * 12.9898) * 43758.5453;
    return pseudo - Math.floor(pseudo);
  });
  
  return vector;
}

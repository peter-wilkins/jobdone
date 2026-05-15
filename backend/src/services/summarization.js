import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Summarize transcript and extract fields using Claude
 * @param {string} transcript - Raw transcript from Whisper
 * @returns {Promise<{summary: string, materials: string[], labour_minutes: number|null, follow_ups: string[], possible_future_work: string}>}
 */
export async function summarizeAndExtract(transcript) {
  try {
    const systemPrompt = `You are a helpful assistant for plumbers. Your job is to:
1. Create a clean, natural narrative summary of what the plumber did
2. Extract key information in a structured format

Important:
- Write the summary in the plumber's voice (first person, casual but professional)
- Only extract information that was explicitly mentioned
- If something wasn't mentioned, don't guess or estimate
- Keep the summary 1-2 sentences, conversational
- Be precise about materials and times`;

    const userPrompt = `Here's a voice transcript from a plumber about a job they just completed:

"${transcript}"

Please provide:
1. A clean 1-2 sentence summary written in their voice
2. A JSON object with:
   - materials: array of materials used (exact names from transcript)
   - labour_minutes: number of minutes spent (null if not mentioned)
   - follow_ups: array of follow-up tasks mentioned
   - possible_future_work: any potential future work discussed (empty string if none)

Format your response as:
SUMMARY: [summary here]
JSON: [json object here]`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    const content = response.content[0].text;

    // Parse response
    const summaryMatch = content.match(/SUMMARY:\s*(.+?)(?=JSON:|$)/s);
    const jsonMatch = content.match(/JSON:\s*({[\s\S]*})/);

    const summary = summaryMatch ? summaryMatch[1].trim() : transcript.substring(0, 100);

    let extracted = {
      materials: [],
      labour_minutes: null,
      follow_ups: [],
      possible_future_work: '',
    };

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        extracted = {
          materials: parsed.materials || [],
          labour_minutes: parsed.labour_minutes || null,
          follow_ups: parsed.follow_ups || [],
          possible_future_work: parsed.possible_future_work || '',
        };
      } catch (e) {
        console.warn('Failed to parse Claude JSON response, using defaults', e);
      }
    }

    return {
      summary,
      ...extracted,
    };
  } catch (error) {
    console.error('Summarization error:', error);
    throw new Error(`Failed to summarize transcript: ${error.message}`);
  }
}

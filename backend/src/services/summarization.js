import axios from 'axios';
import { mockSummarizeAndExtract } from './mocks.js';

const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

/**
 * Summarize transcript using Claude API
 * @param {string} transcript - Raw transcript from Whisper
 * @returns {Promise<{summary: string}>}
 */
export async function summarizeAndExtract(transcript) {
  try {
    // Use mock if enabled
    if (USE_MOCK) {
      return await mockSummarizeAndExtract(transcript);
    }

    const systemPrompt = `You are a helpful assistant for tradespeople. Your job is to create a clean, natural narrative summary of what the tradesperson did.

Important:
- Write the summary in the plumber's voice (first person, casual but professional)
- Only include information that was explicitly mentioned
- If something wasn't mentioned, don't guess or estimate
- Keep the summary 1-2 sentences, conversational`;

    const userPrompt = `Here's a voice transcript from a plumber about a job they just completed:

"${transcript}"

Please provide a clean 1-2 sentence summary written in their voice.

Format your response as:
SUMMARY: [summary here]`;

    console.log('[Claude] Calling Anthropic API...');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log('[Claude] Response received');

    const content = response.data.content[0].text;

    // Parse response
    const summaryMatch = content.match(/SUMMARY:\s*(.+?)(?=JSON:|$)/s);
    const summary = summaryMatch ? summaryMatch[1].trim() : transcript.substring(0, 100);

    console.log('[Claude] Summarization complete');

    return {
      summary,
    };
  } catch (error) {
    console.error('Summarization error:', error.response?.data || error.message);
    throw new Error(`Failed to summarize transcript: ${error.response?.data?.error?.message || error.message}`);
  }
}

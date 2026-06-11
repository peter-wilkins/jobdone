/**
 * Mock Voyage embeddings
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

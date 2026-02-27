import 'dotenv/config';

const AI_ENDPOINT = 'https://ai.hackclub.com/proxy/v1/responses';
const AI_API_KEY = process.env.AI_API_KEY || '';
const FAQ_BASE_URL = process.env.FAQ_BASE_URL || 'https://horizons.hackclub.com/faq';
const FAQ_MARKDOWN_URL = process.env.FAQ_MARKDOWN_URL || 'https://horizons.hackclub.com/content/faq.md';

interface FAQEntry {
  header: string;
  slug: string;
  content: string;
}

let cachedFAQEntries: FAQEntry[] | null = null;

/**
 * Converts a markdown header into a URL-friendly slug.
 */
function slugify(header: string): string {
  return header
    .toLowerCase()
    .replace(/'/g, '-')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

/**
 * Fetches and parses the FAQ markdown into structured entries.
 * Caches the result to avoid repeated fetches.
 */
async function getFAQEntries(): Promise<FAQEntry[]> {
   if (cachedFAQEntries) return cachedFAQEntries;

   const res = await fetch(FAQ_MARKDOWN_URL);
  if (!res.ok) {
    console.error(`Failed to fetch FAQ: ${res.status}`);
    return [];
  }

  const markdown = await res.text();
  const entries: FAQEntry[] = [];
  const sections = markdown.split(/^## /m).slice(1);

  for (const section of sections) {
    const newlineIndex = section.indexOf('\n');
    const header = section.substring(0, newlineIndex).trim();
    const content = section.substring(newlineIndex + 1).trim();
    entries.push({ header, slug: slugify(header), content });
  }

  cachedFAQEntries = entries;
  return entries;
}

/**
 * Invalidates the cached FAQ entries so they are re-fetched on next call.
 */
export function clearFAQCache(): void {
  cachedFAQEntries = null;
}

/**
 * Uses AI to check if any FAQ entries answer the user's question.
 * Returns a formatted message with links to matching FAQ sections, or null if none match.
 */
export async function checkFAQ(userQuestion: string): Promise<string | null> {
  const entries = await getFAQEntries();
  if (entries.length === 0) return null;

  const faqList = entries
    .map((e, i) => `${i + 1}. [${e.slug}] ${e.header}\n${e.content}`)
    .join('\n\n');

  const systemPrompt = `You are a helpful assistant that matches user questions to FAQ entries. You will be given a list of FAQ entries and a user question. Return ONLY the slugs (the text in square brackets) of FAQ entries that answer the user's question, separated by commas. If no FAQ entries are relevant, return "NONE". Do not explain anything, just return the slugs or "NONE".`;
  console.log("Sending API request")
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AI_API_KEY && { 'Authorization': `Bearer ${AI_API_KEY}` }),
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      instructions: systemPrompt,
      input: `FAQ entries:\n${faqList}\n\nUser question: ${userQuestion}`,
      max_output_tokens: 9000,
    }),
  });
  if (!res.ok) {
    console.error(`AI request failed: ${res.status}`);
    return null;
  }

  const data: any = await res.json();
  // console.log('AI response:', JSON.stringify(data, null, 2));
  const outputItem = data.output?.find((o: any) => o.type === 'message');
  const answer: string = outputItem?.content?.find((c: any) => c.type === 'output_text')?.text?.trim() ?? '';

  if (!answer || answer === 'NONE') return null;

  const matchedSlugs = answer.split(',').map((s: string) => s.trim().replace(/^\[|\]$/g, ''));
  const matchedEntries = entries.filter((e) => matchedSlugs.includes(e.slug));

  if (matchedEntries.length === 0) return null;

  const links = matchedEntries
    .map((e) => `${FAQ_BASE_URL}#${e.slug}`)
    .join('\n');

  return `The following FAQ's should answer your question:\n${links}`;
}

// Run directly with: pnpm tsx src/hcai.ts
if (require.main === module) {
  (async () => {
    const testQuestions = [
      'Can I use ChatGPT to help me code?',
      'How old do I have to be?',
      'What is the airspeed velocity of an unladen swallow?',
    ];

    for (const q of testQuestions) {
      console.log(`\n--- Question: "${q}" ---`);
      const result = await checkFAQ(q);
      console.log(result ?? 'No matching FAQ found.');
    }
  })();
}

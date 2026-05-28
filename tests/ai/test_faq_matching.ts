/**
 * Tests the AI FAQ matching used by the bot.
 *
 * These exercise `checkFAQ` the exact same way `src/slack.ts` does on a new
 * help-channel message: call it with the raw user text and act on the
 * returned string (post + auto-resolve) or null (leave the ticket open).
 *
 * Because the bot makes real calls to Groq and the remote FAQ markdown, so do
 * these tests — there is no mocking, this verifies the live integration. If
 * `AI_API_KEY` is absent the AI step is skipped at runtime, so the tests skip
 * too rather than report a false failure.
 */

import 'dotenv/config';
import { checkFAQ, clearFAQCache } from '../../src/hcai';
import { TestCase, assert, skip } from '../helpers';

const FAQ_BASE_URL = process.env.FAQ_BASE_URL || 'https://horizons.hackclub.com/faq';

function requireApiKey(): void {
  if (!process.env.AI_API_KEY) {
    skip('AI_API_KEY not set — AI matching is disabled, same as the bot would skip it');
  }
}

export const faqMatchingTests: TestCase[] = [
  {
    // Happy path: a question that the FAQ should answer must return a
    // non-empty message containing a link to the matched FAQ section.
    name: 'checkFAQ returns FAQ links for an on-topic question',
    run: async () => {
      requireApiKey();
      clearFAQCache();

      const result = await checkFAQ('Can I use AI tools like ChatGPT to help me code my project?');

      assert(result !== null, 'expected a FAQ match for an on-topic question, got null');
      assert(
        (result as string).includes(FAQ_BASE_URL),
        `expected the result to link to the FAQ base URL (${FAQ_BASE_URL}), got: ${result}`
      );
    },
  },
  {
    // Negative path: an unrelated question must not match any FAQ entry, so
    // the bot leaves the ticket open for staff instead of auto-resolving.
    name: 'checkFAQ returns null for an unrelated question',
    run: async () => {
      requireApiKey();
      clearFAQCache();

      const result = await checkFAQ('What is the airspeed velocity of an unladen swallow?');

      assert(result === null, `expected no FAQ match for an unrelated question, got: ${result}`);
    },
  },
];

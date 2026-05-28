/**
 * Central test entry point. Run with `pnpm test`.
 *
 * Each suite is a named array of test cases. Add new suites here as the
 * tests/ folder grows so a single command runs everything.
 */

import { runTests, TestCase } from './helpers';
import { faqMatchingTests } from './ai/test_faq_matching';

const suites: { name: string; cases: TestCase[] }[] = [
  { name: 'AI FAQ matching', cases: faqMatchingTests },
];

(async () => {
  let totalFailures = 0;

  for (const suite of suites) {
    console.log(`\n# ${suite.name}`);
    totalFailures += await runTests(suite.cases);
  }

  // Non-zero exit so CI / `pnpm test` fails when any test fails.
  process.exit(totalFailures > 0 ? 1 : 0);
})();

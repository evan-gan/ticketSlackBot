/**
 * Minimal zero-dependency test harness.
 *
 * The project has no test framework installed, so we provide just enough:
 * a way to register named tests, assertions that throw on failure, and a
 * runner that reports results and sets the process exit code.
 */

export interface TestCase {
  name: string;
  run: () => Promise<void> | void;
}

/** Thrown when a test should be skipped rather than pass or fail (e.g. missing API key). */
export class SkipTest extends Error {}

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function skip(reason: string): never {
  throw new SkipTest(reason);
}

/**
 * Runs every test case in order, printing a per-test result line.
 *
 * @param cases - Test cases to execute.
 * @returns Number of failed tests (0 means the whole suite passed).
 */
export async function runTests(cases: TestCase[]): Promise<number> {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const testCase of cases) {
    try {
      await testCase.run();
      passed++;
      console.log(`  ✅ ${testCase.name}`);
    } catch (error) {
      if (error instanceof SkipTest) {
        skipped++;
        console.log(`  ⏭️  ${testCase.name} — skipped: ${error.message}`);
        continue;
      }
      failed++;
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${testCase.name}\n       ${detail}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  return failed;
}

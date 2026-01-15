/**
 * Central rate limiter for Slack API calls.
 * Ensures we don't exceed Slack's per-endpoint rate limits by queuing requests
 * and processing them in order (oldest first) for each endpoint.
 */

import {
  ENDPOINT_RATE_LIMITS,
} from './constants';

export enum CallPriority {
  High = 0,
  Normal = 1,
  Low = 2,
}

interface QueuedRequest {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  priority: CallPriority;
  timestamp: number;
}

/**
 * Per-endpoint rate limiter that manages API call queuing and throttling.
 */
class EndpointRateLimiter {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private requestTimestamps: number[] = [];
  private lastRequestTime = 0;
  
  constructor(
    private endpoint: string,
    private requestsPerMinute: number,
    private requestsPerSecond?: number
  ) {}

  /**
   * Executes a function with rate limiting.
   * Queues the request if rate limit would be exceeded.
   * @param fn - The async function to execute
   * @param priority - The priority of the request
   * @returns Promise that resolves with the function result
   */
  async execute<T>(fn: () => Promise<T>, priority: CallPriority = CallPriority.Normal): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        fn,
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      };

      // Add to queue and sort by priority (stable sort by timestamp for same priority)
      this.queue.push(request);
      this.queue.sort((a, b) => (a.priority - b.priority) || (a.timestamp - b.timestamp));

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Processes queued requests while respecting rate limits.
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // Check if we can make a request
      if (this.shouldWait()) {
        const waitTime = this.getWaitTime();
        await this.sleep(waitTime);
      }

      // Get oldest request from queue
      const request = this.queue.shift();
      if (!request) break;

      try {
        // Execute the request
        const result = await request.fn();
        request.resolve(result);

        // Record this request
        const now = Date.now();
        this.requestTimestamps.push(now);
        this.lastRequestTime = now;

        // Clean up old timestamps (older than 1 minute)
        this.cleanupTimestamps();
      } catch (error) {
        request.reject(error);
      }
    }

    this.processing = false;
  }

  /**
   * Checks if we should wait before making the next request.
   */
  private shouldWait(): boolean {
    const now = Date.now();

    // Check per-second limit (if applicable)
    if (this.requestsPerSecond) {
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < 1000 / this.requestsPerSecond) {
        return true;
      }
    }

    // Check per-minute limit
    const requestsInLastMinute = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 60000
    ).length;

    if (requestsInLastMinute >= this.requestsPerMinute) {
      return true;
    }

    return false;
  }

  /**
   * Calculates how long to wait before the next request.
   */
  private getWaitTime(): number {
    const now = Date.now();
    let maxWait = 0;

    // Calculate wait time for per-second limit (if applicable)
    if (this.requestsPerSecond) {
      const timeSinceLastRequest = now - this.lastRequestTime;
      const perSecondWait = Math.max(
        0,
        1000 / this.requestsPerSecond - timeSinceLastRequest
      );
      maxWait = Math.max(maxWait, perSecondWait);
    }

    // Calculate wait time for per-minute limit
    const requestsInLastMinute = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 60000
    );

    if (requestsInLastMinute.length >= this.requestsPerMinute) {
      const oldestRequest = requestsInLastMinute[0];
      const perMinuteWait = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
      maxWait = Math.max(maxWait, perMinuteWait);
    }

    return maxWait;
  }

  /**
   * Removes timestamps older than 1 minute from tracking.
   */
  private cleanupTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => timestamp > oneMinuteAgo
    );
  }

  /**
   * Helper to sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets stats about the current queue.
   */
  getStats() {
    const now = Date.now();
    const requestsInLastMinute = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < 60000
    ).length;

    return {
      endpoint: this.endpoint,
      queueLength: this.queue.length,
      requestsInLastMinute,
      requestsPerMinute: this.requestsPerMinute,
      requestsPerSecond: this.requestsPerSecond,
      timeSinceLastRequest: now - this.lastRequestTime,
    };
  }
}

/**
 * Global rate limiter manager that creates per-endpoint rate limiters.
 */
class RateLimiterManager {
  private limiters = new Map<string, EndpointRateLimiter>();

  /**
   * Gets or creates a rate limiter for a specific endpoint.
   */
  private getLimiter(endpoint: string): EndpointRateLimiter {
    if (!this.limiters.has(endpoint)) {
      const config = ENDPOINT_RATE_LIMITS[endpoint];
      if (!config) {
        throw new Error(`No rate limit configuration found for endpoint: ${endpoint}`);
      }
      
      const limiter = new EndpointRateLimiter(
        endpoint,
        config.requestsPerMinute,
        config.requestsPerSecond
      );
      this.limiters.set(endpoint, limiter);
    }
    
    return this.limiters.get(endpoint)!;
  }

  /**
   * Executes a function with rate limiting for a specific endpoint.
   * @param endpoint - The Slack API endpoint (e.g., 'chat.postMessage')
   * @param fn - The async function to execute
   * @param priority - The priority of the request
   * @returns Promise that resolves with the function result
   */
  async execute<T>(endpoint: string, fn: () => Promise<T>, priority: CallPriority = CallPriority.Normal): Promise<T> {
    const limiter = this.getLimiter(endpoint);
    return limiter.execute(fn, priority);
  }

  /**
   * Gets stats for all active rate limiters.
   */
  getAllStats() {
    const stats: Record<string, any> = {};
    for (const [endpoint, limiter] of this.limiters.entries()) {
      stats[endpoint] = limiter.getStats();
    }
    return stats;
  }
}

// Create global instance
const rateLimiterManager = new RateLimiterManager();

/**
 * Wraps an async function with rate limiting for a specific Slack API endpoint.
 * Queues the request if the rate limit would be exceeded.
 * 
 * @param endpoint - The Slack API endpoint (e.g., 'chat.postMessage', 'reactions.add')
 * @param fn - The async function to execute
 * @returns Promise that resolves with the function result
 * 
 * @example
 * const result = await rateLimitedCall('chat.postMessage', () =>
 *   client.chat.postMessage({ channel: 'C123', text: 'Hello!' })
 * );
 */
export async function rateLimitedCall<T>(
  endpoint: string,
  fn: () => Promise<T>,
  priority: CallPriority = CallPriority.Normal
): Promise<T> {
  return rateLimiterManager.execute(endpoint, fn, priority);
}

/**
 * Gets statistics about all rate limiters for monitoring.
 * @returns Object with stats for each endpoint
 */
export function getRateLimiterStats() {
  return rateLimiterManager.getAllStats();
}

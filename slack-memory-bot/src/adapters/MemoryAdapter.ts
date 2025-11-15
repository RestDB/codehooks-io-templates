import { Memory } from '../utils/types';

/**
 * Memory Adapter Interface
 * Defines the contract for different memory storage implementations
 */
export interface MemoryAdapter {
  /**
   * Store a new memory for a user
   * @param userId - Slack user ID
   * @param content - The memory content to store
   * @param metadata - Optional metadata (channel, timestamp, etc.)
   * @returns The created memory with ID
   */
  remember(
    userId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<Memory>;

  /**
   * Retrieve memories using semantic search
   * @param userId - Slack user ID
   * @param query - Search query
   * @param limit - Maximum number of results (default: 5)
   * @returns Array of memories sorted by relevance
   */
  recall(userId: string, query: string, limit?: number): Promise<Memory[]>;

  /**
   * List all memories for a user
   * @param userId - Slack user ID
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of memories sorted by timestamp (newest first)
   */
  list(userId: string, limit?: number): Promise<Memory[]>;

  /**
   * Delete a specific memory
   * @param userId - Slack user ID
   * @param memoryId - ID of the memory to delete
   * @returns True if deleted, false if not found
   */
  forget(userId: string, memoryId: string): Promise<boolean>;

  /**
   * Clear all memories for a user
   * @param userId - Slack user ID
   * @returns True if successful
   */
  clear(userId: string): Promise<boolean>;

  /**
   * Get adapter name for logging/debugging
   */
  getName(): string;
}

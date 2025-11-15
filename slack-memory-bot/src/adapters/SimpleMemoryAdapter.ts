import { Datastore } from 'codehooks-js';
import { MemoryAdapter } from './MemoryAdapter';
import { Memory } from '../utils/types';

/**
 * Simple Memory Adapter
 * Uses Codehooks NoSQL database with basic keyword matching
 * No external dependencies - perfect for development and demos
 */
export class SimpleMemoryAdapter implements MemoryAdapter {
  private readonly collectionName = 'memories';

  getName(): string {
    return 'SimpleMemoryAdapter';
  }

  async remember(
    userId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<Memory> {
    const conn = await Datastore.open();

    const memoryDoc = {
      userId,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      metadata: metadata || {},
      // Store lowercase version for case-insensitive search
      searchableContent: content.toLowerCase(),
    };

    const result: any = await conn.insertOne(this.collectionName, memoryDoc);

    return {
      id: result._id,
      userId: result.userId,
      content: result.content,
      timestamp: new Date(result.timestamp),
      metadata: result.metadata,
    };
  }

  async recall(
    userId: string,
    query: string,
    limit: number = 5
  ): Promise<Memory[]> {
    const conn = await Datastore.open();

    // Create search keywords from query (split by spaces, lowercase)
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2); // Only words with 3+ characters

    if (keywords.length === 0) {
      // If no valid keywords, return recent memories
      return this.list(userId, limit);
    }

    // Build regex pattern for keyword matching
    // This searches for any of the keywords in the content
    const pattern = keywords.join('|');

    const memories = await conn
      .getMany(this.collectionName, {
        userId,
        searchableContent: { $regex: pattern },
      })
      .toArray();

    // Calculate simple relevance score based on keyword matches
    const scoredMemories = memories.map((doc: any) => {
      const contentLower = doc.searchableContent;
      let score = 0;

      // Count how many keywords match
      keywords.forEach((keyword) => {
        if (contentLower.includes(keyword)) {
          score++;
        }
      });

      return {
        id: doc._id,
        userId: doc.userId,
        content: doc.content,
        timestamp: new Date(doc.timestamp),
        metadata: doc.metadata,
        relevanceScore: score,
      };
    });

    // Sort by relevance score (descending) and limit results
    return scoredMemories
      .sort((a, b) => b.relevanceScore! - a.relevanceScore!)
      .slice(0, limit);
  }

  async list(userId: string, limit: number = 10): Promise<Memory[]> {
    const conn = await Datastore.open();

    const memories = await conn
      .getMany(
        this.collectionName,
        { userId },
        {
          sort: { timestamp: -1 }, // Newest first
          limit,
        }
      )
      .toArray();

    return memories.map((doc: any) => ({
      id: doc._id,
      userId: doc.userId,
      content: doc.content,
      timestamp: new Date(doc.timestamp),
      metadata: doc.metadata,
    }));
  }

  async forget(userId: string, memoryId: string): Promise<boolean> {
    const conn = await Datastore.open();

    try {
      // First check if the memory exists
      const existing = await conn.getOne(this.collectionName, {
        _id: memoryId,
        userId, // Ensure user can only delete their own memories
      });

      if (!existing) {
        return false;
      }

      // Delete it
      await conn.removeOne(this.collectionName, {
        _id: memoryId,
        userId,
      });

      return true;
    } catch (error) {
      console.error('Error forgetting memory:', error);
      return false;
    }
  }

  async clear(userId: string): Promise<boolean> {
    const conn = await Datastore.open();

    try {
      await conn.removeMany(this.collectionName, { userId });
      return true;
    } catch (error) {
      console.error('Error clearing memories:', error);
      return false;
    }
  }
}

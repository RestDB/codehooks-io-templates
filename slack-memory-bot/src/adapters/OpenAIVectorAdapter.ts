import { Datastore } from 'codehooks-js';
import { MemoryAdapter } from './MemoryAdapter';
import { Memory } from '../utils/types';
import fetch from 'node-fetch';

/**
 * OpenAI Vector Memory Adapter
 * Uses OpenAI embeddings for semantic search
 * Stores embeddings in Codehooks NoSQL database
 */
export class OpenAIVectorAdapter implements MemoryAdapter {
  private readonly collectionName = 'memories_vector';
  private readonly apiKey: string;
  private readonly model = 'text-embedding-3-small'; // Cost-effective model

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is required for OpenAIVectorAdapter. Set OPENAI_API_KEY environment variable.'
      );
    }
  }

  getName(): string {
    return 'OpenAIVectorAdapter';
  }

  /**
   * Generate embeddings using OpenAI API
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data: any = await response.json();
    return data.data[0].embedding;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async remember(
    userId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<Memory> {
    const conn = await Datastore.open();

    // Generate embedding for the content
    const embedding = await this.generateEmbedding(content.trim());

    const memoryDoc = {
      userId,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      metadata: metadata || {},
      embedding, // Store the vector
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

    // Generate embedding for the query
    const queryEmbedding = await this.generateEmbedding(query);

    // Fetch all memories for the user
    // Note: Loads all into memory to calculate similarity and sort
    // Works well for up to ~1000 memories per user
    const allMemories = await conn
      .getMany(this.collectionName, { userId })
      .toArray();

    if (allMemories.length === 0) {
      return [];
    }

    // Calculate similarity scores for each memory
    const scoredMemories = allMemories.map((doc: any) => {
      const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);

      return {
        id: doc._id,
        userId: doc.userId,
        content: doc.content,
        timestamp: new Date(doc.timestamp),
        metadata: doc.metadata,
        relevanceScore: similarity,
      };
    });

    // Sort by similarity (descending) and return top results
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
        userId,
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

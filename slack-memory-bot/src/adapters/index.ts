import { MemoryAdapter } from './MemoryAdapter';
import { SimpleMemoryAdapter } from './SimpleMemoryAdapter';
import { OpenAIVectorAdapter } from './OpenAIVectorAdapter';

export { MemoryAdapter } from './MemoryAdapter';
export { SimpleMemoryAdapter } from './SimpleMemoryAdapter';
export { OpenAIVectorAdapter } from './OpenAIVectorAdapter';

export type AdapterType = 'simple' | 'openai';

/**
 * Create a memory adapter based on environment configuration
 * @param adapterType - Type of adapter to create (defaults to env MEMORY_ADAPTER or 'simple')
 * @returns Configured memory adapter instance
 */
export function createMemoryAdapter(
  adapterType?: AdapterType
): MemoryAdapter {
  const type = adapterType || (process.env.MEMORY_ADAPTER as AdapterType) || 'simple';

  console.log(`Creating memory adapter: ${type}`);

  switch (type) {
    case 'simple':
      return new SimpleMemoryAdapter();

    case 'openai':
      return new OpenAIVectorAdapter(process.env.OPENAI_API_KEY);

    default:
      console.warn(
        `Unknown adapter type "${type}", falling back to SimpleMemoryAdapter`
      );
      return new SimpleMemoryAdapter();
  }
}

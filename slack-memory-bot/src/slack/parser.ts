import { CommandType, ParsedCommand } from '../utils/types';

/**
 * Parse a Slack message and extract the command and content
 * Supports natural language commands like:
 * - "remember John likes pizza"
 * - "recall what does John like"
 * - "what do you know about John"
 * - "list my memories"
 * - "forget memory abc123"
 * - "clear all memories"
 * - "help"
 */
export function parseMessage(text: string, botUserId?: string): ParsedCommand {
  // Remove bot mention if present
  let cleanText = text;
  if (botUserId) {
    cleanText = text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
  }

  const lowerText = cleanText.toLowerCase().trim();

  // Help command
  if (
    lowerText === 'help' ||
    lowerText.includes('how do') ||
    lowerText.includes('what can you')
  ) {
    return { type: CommandType.HELP };
  }

  // Clear command
  if (
    lowerText.includes('clear all') ||
    lowerText.includes('delete all') ||
    lowerText.includes('forget everything')
  ) {
    return { type: CommandType.CLEAR };
  }

  // Forget command (specific memory)
  if (lowerText.startsWith('forget') && !lowerText.includes('everything')) {
    // Extract memory ID if provided
    const memoryIdMatch = cleanText.match(/forget\s+(?:memory\s+)?(\S+)/i);
    if (memoryIdMatch && memoryIdMatch[1]) {
      return {
        type: CommandType.FORGET,
        memoryId: memoryIdMatch[1],
      };
    }
    return { type: CommandType.FORGET };
  }

  // List command
  if (
    lowerText.includes('list') ||
    lowerText.includes('show all') ||
    lowerText.includes('what do you know') ||
    lowerText.includes('what have you remembered')
  ) {
    return { type: CommandType.LIST };
  }

  // Remember command
  if (lowerText.startsWith('remember') || lowerText.startsWith('store')) {
    const content = cleanText.replace(/^(remember|store)\s+/i, '').trim();
    if (content) {
      return {
        type: CommandType.REMEMBER,
        content,
      };
    }
    return { type: CommandType.REMEMBER };
  }

  // Recall/Search command
  if (
    lowerText.startsWith('recall') ||
    lowerText.startsWith('search') ||
    lowerText.startsWith('find') ||
    lowerText.startsWith('what about') ||
    lowerText.startsWith('tell me about')
  ) {
    const content = cleanText
      .replace(/^(recall|search|find|what about|tell me about)\s+/i, '')
      .trim();
    if (content) {
      return {
        type: CommandType.RECALL,
        content,
      };
    }
    return { type: CommandType.RECALL };
  }

  // Default: if the message is long enough, treat as remember command
  // This allows natural language like "John likes pizza"
  if (cleanText.length > 10) {
    return {
      type: CommandType.REMEMBER,
      content: cleanText,
    };
  }

  return { type: CommandType.UNKNOWN };
}

/**
 * Format a help message explaining how to use the bot
 */
export function getHelpMessage(): string {
  return `*Slack Memory Bot* - Store and recall information

*Commands:*
• \`remember [text]\` - Store a new memory
  Example: "remember John likes pizza"

• \`recall [query]\` - Search your memories
  Example: "recall pizza" or "what about John?"

• \`list\` - Show all your memories
  Example: "list my memories"

• \`forget [memory-id]\` - Delete a specific memory
  Example: "forget abc123"

• \`clear all\` - Delete all your memories

• \`help\` - Show this help message

*Tips:*
• You can also just type naturally: "John likes pizza" will be stored
• Search works semantically - try "what food does John like?"
• Each user has their own private memory space`;
}

import { MemoryAdapter } from '../adapters/index';
import { SlackEvent, CommandType } from '../utils/types';
import { parseMessage, getHelpMessage } from './parser';
import fetch from 'node-fetch';

/**
 * Send a message to Slack channel
 */
async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.error('SLACK_BOT_TOKEN not configured');
    return;
  }

  const payload: any = {
    channel,
    text,
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error('Failed to send Slack message:', await response.text());
  }
}

/**
 * Handle app_mention events (when bot is @mentioned)
 */
export async function handleAppMention(
  event: SlackEvent,
  memoryAdapter: MemoryAdapter
): Promise<void> {
  if (!event.user || !event.text || !event.channel) {
    console.warn('Invalid app_mention event:', event);
    return;
  }

  const userId = event.user;
  const botUserId = process.env.SLACK_BOT_USER_ID;

  // Parse the command
  const command = parseMessage(event.text, botUserId);

  console.log(
    `Processing ${command.type} command from user ${userId}:`,
    command
  );

  let responseText = '';

  try {
    switch (command.type) {
      case CommandType.HELP:
        responseText = getHelpMessage();
        break;

      case CommandType.REMEMBER:
        if (!command.content) {
          responseText = 'Please provide something to remember. Example: `remember John likes pizza`';
        } else {
          const memory = await memoryAdapter.remember(userId, command.content, {
            channel: event.channel,
            timestamp: event.ts,
          });
          responseText = `✅ Remembered! (ID: \`${memory.id}\`)`;
        }
        break;

      case CommandType.RECALL:
        if (!command.content) {
          responseText = 'Please provide a search query. Example: `recall pizza`';
        } else {
          const memories = await memoryAdapter.recall(userId, command.content, 5);
          if (memories.length === 0) {
            responseText = `I couldn't find any memories matching "${command.content}"`;
          } else {
            const lines = memories.map(
              (m, i) =>
                `${i + 1}. ${m.content}${m.relevanceScore ? ` _(score: ${m.relevanceScore.toFixed(2)})_` : ''}\n   ID: \`${m.id}\``
            );
            responseText = `Found ${memories.length} matching memor${memories.length === 1 ? 'y' : 'ies'}:\n\n${lines.join('\n\n')}`;
          }
        }
        break;

      case CommandType.LIST:
        const allMemories = await memoryAdapter.list(userId, 10);
        if (allMemories.length === 0) {
          responseText = "You don't have any memories yet. Try: `remember something interesting`";
        } else {
          const lines = allMemories.map(
            (m, i) =>
              `${i + 1}. ${m.content}\n   ${new Date(m.timestamp).toLocaleString()} - ID: \`${m.id}\``
          );
          responseText = `You have ${allMemories.length} memor${allMemories.length === 1 ? 'y' : 'ies'}:\n\n${lines.join('\n\n')}`;
        }
        break;

      case CommandType.FORGET:
        if (!command.memoryId) {
          responseText = 'Please provide a memory ID to forget. Example: `forget abc123`\nUse `list` to see your memory IDs.';
        } else {
          const success = await memoryAdapter.forget(userId, command.memoryId);
          if (success) {
            responseText = `✅ Forgot memory \`${command.memoryId}\``;
          } else {
            responseText = `❌ Could not find memory \`${command.memoryId}\``;
          }
        }
        break;

      case CommandType.CLEAR:
        const cleared = await memoryAdapter.clear(userId);
        if (cleared) {
          responseText = '✅ All your memories have been cleared';
        } else {
          responseText = '❌ Failed to clear memories';
        }
        break;

      case CommandType.UNKNOWN:
      default:
        responseText = `I didn't understand that. Type \`help\` to see what I can do.`;
        break;
    }
  } catch (error) {
    console.error('Error processing command:', error);
    responseText = `❌ Sorry, an error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  // Send response in thread
  await sendSlackMessage(event.channel, responseText, event.ts);
}

/**
 * Handle direct message events
 */
export async function handleDirectMessage(
  event: SlackEvent,
  memoryAdapter: MemoryAdapter
): Promise<void> {
  // For DMs, we don't need to check for bot mention
  // Just process the message directly
  await handleAppMention(event, memoryAdapter);
}

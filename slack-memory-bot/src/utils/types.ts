/**
 * Core types for Slack Memory Bot
 */

export interface Memory {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  relevanceScore?: number; // For semantic search results
}

export interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  event_ts?: string;
  channel_type?: string;
  bot_id?: string;
}

export interface SlackEventPayload {
  token?: string;
  challenge?: string;
  type: string;
  event?: SlackEvent;
  team_id?: string;
}

export interface SlackMessageResponse {
  channel: string;
  text: string;
  thread_ts?: string;
}

export enum CommandType {
  REMEMBER = 'remember',
  RECALL = 'recall',
  LIST = 'list',
  FORGET = 'forget',
  CLEAR = 'clear',
  HELP = 'help',
  UNKNOWN = 'unknown',
}

export interface ParsedCommand {
  type: CommandType;
  content?: string; // The thing to remember or search for
  memoryId?: string; // For forget command
}

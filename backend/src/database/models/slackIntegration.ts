export type SlackIntegrationStatus = 'ACTIVE' | 'REVOKED' | 'DISCONNECTED';

export interface SlackIntegrationRecord {
  id: string;
  user_id: string;
  user_email: string | null;
  sender: string;
  team_id: string;
  team_name: string;
  channel_id: string | null;
  channel_name: string | null;
  encrypted_access_token: string | null;
  encrypted_webhook_url: string | null;
  scope: string | null;
  bot_user_id: string | null;
  status: SlackIntegrationStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertSlackIntegrationInput {
  id?: string;
  user_id: string;
  user_email?: string | null;
  sender: string;
  team_id: string;
  team_name: string;
  channel_id?: string | null;
  channel_name?: string | null;
  access_token?: string | null;
  webhook_url?: string | null;
  scope?: string | null;
  bot_user_id?: string | null;
}

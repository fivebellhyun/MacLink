import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const ownerIdentities = sqliteTable('owner_identities', {
  owner: text('owner').primaryKey(), emailHash: text('email_hash').notNull(), updated: integer('updated').notNull(),
});
export const inviteVerifications = sqliteTable('invite_verifications', {
  invite: text('invite').primaryKey(), failures: integer('failures').notNull(), window: integer('window').notNull(),
});
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  agentHash: text('agent_hash').notNull(), created: integer('created').notNull(),
  seen: integer('seen').notNull().default(0), enabled: integer('enabled').notNull().default(1),
  info: text('info').notNull().default('{}'),
}, t => [index('devices_owner').on(t.owner)]);
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(), device: text('device').notNull(), secretHash: text('secret_hash').notNull(),
  reusable: integer('reusable').notNull().default(0),
  mode: text('mode').notNull(), expires: integer('expires').notNull(), used: integer('used').notNull().default(0),
}, t => [index('invites_device').on(t.device)]);
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), device: text('device').notNull(), invite: text('invite').notNull(),
  guestHash: text('guest_hash').notNull(), guestName: text('guest_name').notNull(), mode: text('mode').notNull(),
  generation: integer('generation').notNull().default(0),
  status: text('status').notNull(),
  offer: text('offer').notNull(), answer: text('answer'), created: integer('created').notNull(),
  expires: integer('expires').notNull(), seen: integer('seen').notNull(), reason: text('reason'),
  quality: text('quality').notNull().default('balanced'), qualityApplied: text('quality_applied'),
}, t => [index('sessions_device').on(t.device)]);
export const turnSettings = sqliteTable('turn_settings', {
  owner: text('owner').primaryKey(), sealed: text('sealed').notNull(), updated: integer('updated').notNull(),
});
export const turnCredentials = sqliteTable('turn_credentials', {
  subject: text('subject').primaryKey(), owner: text('owner').notNull(),
  sealed: text('sealed').notNull(), expires: integer('expires').notNull(),
}, t => [index('turn_credentials_owner').on(t.owner), index('turn_credentials_expires').on(t.expires)]);
export const authUsers = sqliteTable('auth_users', {
  id: text('id').primaryKey(), googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(), name: text('name'),
  created: integer('created').notNull(), updated: integer('updated').notNull(),
});
export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  created: integer('created').notNull(), expires: integer('expires').notNull(),
}, t => [index('auth_sessions_user').on(t.userId), index('auth_sessions_expires').on(t.expires)]);
export const authTransactions = sqliteTable('auth_transactions', {
  stateHash: text('state_hash').primaryKey(), browserHash: text('browser_hash').notNull(),
  verifier: text('verifier').notNull(), nonce: text('nonce').notNull(), returnPath: text('return_path').notNull(),
  expires: integer('expires').notNull(),
}, t => [index('auth_transactions_expires').on(t.expires)]);

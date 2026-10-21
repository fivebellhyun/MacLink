import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  agentHash: text('agent_hash').notNull(), created: integer('created').notNull(),
  seen: integer('seen').notNull().default(0), enabled: integer('enabled').notNull().default(1),
  info: text('info').notNull().default('{}'),
}, t => [index('devices_owner').on(t.owner)]);
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), device: text('device').notNull(),
  owner: text('owner'), authSessionHash: text('auth_session_hash'),
  guestHash: text('guest_hash').notNull(), guestName: text('guest_name').notNull(), mode: text('mode').notNull(),
  generation: integer('generation').notNull().default(0),
  status: text('status').notNull(),
  offer: text('offer').notNull(), answer: text('answer'), created: integer('created').notNull(),
  expires: integer('expires').notNull(), seen: integer('seen').notNull(), reason: text('reason'),
  quality: text('quality').notNull().default('balanced'), qualityApplied: text('quality_applied'),
}, t => [index('sessions_device').on(t.device), index('sessions_auth').on(t.authSessionHash)]);
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

export const enrollments = sqliteTable('enrollments', {
  id: text('id').primaryKey(), claimHash: text('claim_hash').notNull(), credentialHash: text('credential_hash').notNull(),
  name: text('name').notNull(), verificationCode: text('verification_code').notNull(),
  status: text('status').notNull().default('pending'), owner: text('owner'), device: text('device'),
  created: integer('created').notNull(), expires: integer('expires').notNull(), approved: integer('approved'),
  ipHash: text('ip_hash').notNull(), failures: integer('failures').notNull().default(0),
}, t => [index('enrollments_expires').on(t.expires), index('enrollments_approved').on(t.approved)]);
export const enrollmentLimits = sqliteTable('enrollment_limits', {
  bucket: text('bucket').primaryKey(), requests: integer('requests').notNull(), window: integer('window').notNull(),
}, t => [index('enrollment_limits_window').on(t.window)]);

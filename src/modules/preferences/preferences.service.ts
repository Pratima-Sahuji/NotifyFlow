import crypto from 'crypto';
import { query } from '../../database/connection.js';
import { UpdatePreferenceInput } from './preferences.schema.js';

export class PreferencesService {
  public async getUserPreferences(userId: string) {
    const res = await query(
      `SELECT channel, event_type, enabled, quiet_hours_start, quiet_hours_end, updated_at
       FROM notification_preferences
       WHERE user_id = $1
       ORDER BY channel, event_type`,
      [userId]
    );

    return res.rows;
  }

  public async updatePreference(userId: string, input: UpdatePreferenceInput) {
    const id = crypto.randomUUID();
    const res = await query(
      `INSERT INTO notification_preferences (
         id, user_id, channel, event_type, enabled, quiet_hours_start, quiet_hours_end, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, channel, event_type)
       DO UPDATE SET 
         enabled = EXCLUDED.enabled,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        userId,
        input.channel,
        input.eventType,
        input.enabled,
        input.quietHoursStart || null,
        input.quietHoursEnd || null,
      ]
    );

    return res.rows[0];
  }
}

export const preferencesService = new PreferencesService();

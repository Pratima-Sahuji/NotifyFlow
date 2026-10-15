import crypto from 'crypto';
import { query } from '../../database/connection.js';
import { RegisterDeviceTokenInput } from './devices.schema.js';

export class DevicesService {
  public async registerToken(userId: string, input: RegisterDeviceTokenInput) {
    const id = crypto.randomUUID();
    const res = await query(
      `INSERT INTO device_tokens (id, user_id, token, platform, is_active, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (user_id, token) 
       DO UPDATE SET platform = EXCLUDED.platform, is_active = TRUE, updated_at = NOW()
       RETURNING *`,
      [id, userId, input.token, input.platform]
    );

    return res.rows[0];
  }

  public async removeToken(userId: string, token: string): Promise<boolean> {
    const res = await query(
      `UPDATE device_tokens
       SET is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND token = $2`,
      [userId, token]
    );

    return (res.rowCount || 0) > 0;
  }

  public async listUserTokens(userId: string) {
    const res = await query(
      `SELECT id, token, platform, is_active, created_at, updated_at
       FROM device_tokens
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`,
      [userId]
    );

    return res.rows;
  }
}

export const devicesService = new DevicesService();

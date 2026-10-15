import { query } from '../../database/connection.js';
import { ListNotificationsQuery } from './notifications.schema.js';

export class NotificationsService {
  public async getUserNotifications(userId: string, filter: ListNotificationsQuery) {
    const offset = (filter.page - 1) * filter.limit;
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [userId];

    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }

    if (filter.type) {
      values.push(filter.type);
      conditions.push(`type = $${values.length}`);
    }

    const whereClause = conditions.join(' AND ');

    // Count unread and total
    const [countRes, unreadRes] = await Promise.all([
      query(`SELECT count(*) as total FROM notifications WHERE ${whereClause}`, values),
      query(`SELECT count(*) as unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]),
    ]);

    const total = parseInt(countRes.rows[0]?.total || '0', 10);
    const unreadCount = parseInt(unreadRes.rows[0]?.unread || '0', 10);

    // Fetch items
    values.push(filter.limit);
    values.push(offset);
    const limitClause = `LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const itemsRes = await query(
      `SELECT id, event_id, user_id, actor_id, type, title, body, data, priority, status, read_at, delivered_at, created_at
       FROM notifications
       WHERE ${whereClause}
       ORDER BY created_at DESC
       ${limitClause}`,
      values
    );

    return {
      items: itemsRes.rows,
      meta: {
        page: filter.page,
        limit: filter.limit,
        total,
        totalPages: Math.ceil(total / filter.limit),
        unreadCount,
      },
    };
  }

  public async getNotificationById(notificationId: string, userId?: string) {
    const values: any[] = [notificationId];
    let userClause = '';
    if (userId) {
      values.push(userId);
      userClause = 'AND user_id = $2';
    }

    const notifRes = await query(
      `SELECT * FROM notifications WHERE id = $1 ${userClause}`,
      values
    );

    if (notifRes.rows.length === 0) return null;

    // Also get channel deliveries
    const deliveriesRes = await query(
      `SELECT channel, device_token, status, attempts, last_error, delivered_at, created_at
       FROM notification_deliveries
       WHERE notification_id = $1
       ORDER BY created_at ASC`,
      [notificationId]
    );

    return {
      ...notifRes.rows[0],
      deliveries: deliveriesRes.rows,
    };
  }

  public async markAsRead(notificationId: string, userId: string) {
    const res = await query(
      `UPDATE notifications
       SET read_at = NOW(), status = 'read', updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [notificationId, userId]
    );

    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public async markAllAsRead(userId: string) {
    const res = await query(
      `UPDATE notifications
       SET read_at = NOW(), status = 'read', updated_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING count(*)`,
      [userId]
    );

    return { updatedCount: res.rowCount };
  }
}

export const notificationsService = new NotificationsService();

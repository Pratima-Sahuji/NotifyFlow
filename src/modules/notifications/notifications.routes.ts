import { Router } from 'express';
import { notificationsController } from './notifications.controller.js';
import { listNotificationsQuerySchema } from './notifications.schema.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     summary: Retrieve notification history for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [queued, delivered, read, failed, suppressed]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of notifications with pagination metadata
 */
router.get(
  '/',
  authenticate,
  validate({ query: listNotificationsQuerySchema }),
  notificationsController.listNotifications
);

/**
 * @openapi
 * /api/v1/notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read for authenticated user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All unread notifications marked as read
 */
router.post('/read-all', authenticate, notificationsController.markAllAsRead);

/**
 * @openapi
 * /api/v1/notifications/{id}:
 *   get:
 *     summary: Get notification details and channel delivery logs
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification details and deliveries
 *       404:
 *         description: Notification not found
 */
router.get('/:id', authenticate, notificationsController.getNotification);

/**
 * @openapi
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.patch('/:id/read', authenticate, notificationsController.markAsRead);

export default router;

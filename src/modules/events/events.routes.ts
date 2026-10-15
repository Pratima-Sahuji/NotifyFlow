import { Router } from 'express';
import { eventsController } from './events.controller.js';
import { createEventSchema } from './events.schema.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { idempotency } from '../../middleware/idempotency.middleware.js';

const router = Router();

/**
 * @openapi
 * /api/v1/events:
 *   post:
 *     summary: Create and publish a notification event
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optional unique idempotency key to prevent duplicate event creation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventType, title, body, recipients]
 *             properties:
 *               eventType:
 *                 type: string
 *                 example: RIDE_HELP
 *               title:
 *                 type: string
 *                 example: Marshal Announcement
 *               body:
 *                 type: string
 *                 example: Regroup at checkpoint 2
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["user-101", "user-102"]
 *               channels:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [websocket, fcm, email]
 *                 example: ["websocket", "fcm"]
 *               priority:
 *                 type: string
 *                 enum: [low, normal, important, urgent]
 *                 example: urgent
 *               data:
 *                 type: object
 *     responses:
 *       202:
 *         description: Event accepted for processing
 */
router.post(
  '/',
  authenticate,
  idempotency,
  validate({ body: createEventSchema }),
  eventsController.createEvent
);

/**
 * @openapi
 * /api/v1/events/{id}:
 *   get:
 *     summary: Get event details and aggregate notification status
 *     tags: [Events]
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
 *         description: Event status retrieved
 *       404:
 *         description: Event not found
 */
router.get('/:id', authenticate, eventsController.getEvent);

export default router;

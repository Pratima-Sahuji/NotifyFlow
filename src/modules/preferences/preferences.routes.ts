import { Router } from 'express';
import { preferencesController } from './preferences.controller.js';
import { updatePreferenceSchema } from './preferences.schema.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

/**
 * @openapi
 * /api/v1/preferences:
 *   get:
 *     summary: Retrieve notification preferences for the authenticated user
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of user channel preferences and quiet hours
 */
router.get('/', authenticate, preferencesController.getPreferences);

/**
 * @openapi
 * /api/v1/preferences:
 *   put:
 *     summary: Create or update notification preference for a channel
 *     tags: [Preferences]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [channel, enabled]
 *             properties:
 *               channel:
 *                 type: string
 *                 enum: [websocket, fcm, email]
 *               eventType:
 *                 type: string
 *                 default: '*'
 *               enabled:
 *                 type: boolean
 *               quietHoursStart:
 *                 type: string
 *                 example: "22:00"
 *               quietHoursEnd:
 *                 type: string
 *                 example: "07:00"
 *     responses:
 *       200:
 *         description: Updated notification preference
 */
router.put(
  '/',
  authenticate,
  validate({ body: updatePreferenceSchema }),
  preferencesController.updatePreferences
);

export default router;

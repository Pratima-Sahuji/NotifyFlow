import { Router } from 'express';
import { devicesController } from './devices.controller.js';
import { registerDeviceTokenSchema } from './devices.schema.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

/**
 * @openapi
 * /api/v1/devices/tokens:
 *   post:
 *     summary: Register or refresh an FCM push device token
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 example: fcm-device-registration-token-abc123
 *               platform:
 *                 type: string
 *                 enum: [android, ios, web]
 *                 default: android
 *     responses:
 *       200:
 *         description: Device token registered
 */
router.post(
  '/tokens',
  authenticate,
  validate({ body: registerDeviceTokenSchema }),
  devicesController.registerToken
);

/**
 * @openapi
 * /api/v1/devices/tokens:
 *   get:
 *     summary: List active device tokens for the authenticated user
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of registered device tokens
 */
router.get('/tokens', authenticate, devicesController.listTokens);

/**
 * @openapi
 * /api/v1/devices/tokens/{token}:
 *   delete:
 *     summary: Deactivate or remove a device token (e.g., on logout)
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device token removed
 *       404:
 *         description: Token not found
 */
router.delete('/tokens/:token', authenticate, devicesController.removeToken);

export default router;

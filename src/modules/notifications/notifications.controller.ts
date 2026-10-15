import { Request, Response, NextFunction } from 'express';
import { notificationsService } from './notifications.service.js';

export class NotificationsController {
  public async listNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const result = await notificationsService.getUserNotifications(userId, req.query as any);

      res.status(200).json({
        success: true,
        data: result.items,
        meta: result.meta,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async getNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const notif = await notificationsService.getNotificationById(req.params.id, userId);

      if (!notif) {
        res.status(404).json({
          error: 'Not Found',
          message: `Notification with id '${req.params.id}' not found`,
          correlationId: req.correlationId,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: notif,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const notif = await notificationsService.markAsRead(req.params.id, userId);

      if (!notif) {
        res.status(404).json({
          error: 'Not Found',
          message: `Notification with id '${req.params.id}' not found or already read`,
          correlationId: req.correlationId,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: notif,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const result = await notificationsService.markAllAsRead(userId);

      res.status(200).json({
        success: true,
        data: result,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const notificationsController = new NotificationsController();

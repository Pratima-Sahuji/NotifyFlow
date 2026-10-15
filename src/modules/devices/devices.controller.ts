import { Request, Response, NextFunction } from 'express';
import { devicesService } from './devices.service.js';

export class DevicesController {
  public async registerToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const device = await devicesService.registerToken(userId, req.body);

      res.status(200).json({
        success: true,
        data: device,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async removeToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const token = req.params.token;

      const removed = await devicesService.removeToken(userId, token);

      if (!removed) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Device token not found for user',
          correlationId: req.correlationId,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Device token removed successfully',
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async listTokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const tokens = await devicesService.listUserTokens(userId);

      res.status(200).json({
        success: true,
        data: tokens,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const devicesController = new DevicesController();

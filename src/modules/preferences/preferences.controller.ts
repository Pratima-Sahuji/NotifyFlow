import { Request, Response, NextFunction } from 'express';
import { preferencesService } from './preferences.service.js';

export class PreferencesController {
  public async getPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const prefs = await preferencesService.getUserPreferences(userId);

      res.status(200).json({
        success: true,
        data: prefs,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const pref = await preferencesService.updatePreference(userId, req.body);

      res.status(200).json({
        success: true,
        data: pref,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const preferencesController = new PreferencesController();

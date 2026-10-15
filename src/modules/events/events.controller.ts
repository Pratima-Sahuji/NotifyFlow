import { Request, Response, NextFunction } from 'express';
import { eventsService } from './events.service.js';

export class EventsController {
  public async createEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actorId = req.user?.userId || (req.body.actorId as string) || 'system';
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      const result = await eventsService.createEvent(actorId, req.body, idempotencyKey);

      res.status(202).json({
        success: true,
        data: result,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }

  public async getEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const event = await eventsService.getEventById(req.params.id);
      if (!event) {
        res.status(404).json({
          error: 'Not Found',
          message: `Event with id '${req.params.id}' not found`,
          correlationId: req.correlationId,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: event,
        correlationId: req.correlationId,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const eventsController = new EventsController();

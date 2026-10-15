export interface DeliveryResult {
  channel: 'websocket' | 'fcm' | 'email';
  success: boolean;
  recipientId: string;
  deviceToken?: string;
  error?: string;
  isRetryable?: boolean;
}

export interface NotificationPayload {
  notificationId: string;
  eventId: string;
  userId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  priority: 'low' | 'normal' | 'important' | 'urgent';
}

export interface IDeliveryChannel {
  name: 'websocket' | 'fcm' | 'email';
  deliver(notification: NotificationPayload): Promise<DeliveryResult[]>;
}

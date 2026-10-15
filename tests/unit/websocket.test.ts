import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketManager, AuthenticatedWebSocket } from '../../src/delivery/websocket/websocket.manager.js';

describe('WebSocket Connection Management', () => {
  let manager: WebSocketManager;

  beforeEach(() => {
    manager = new WebSocketManager();
  });

  function createMockSocket(): AuthenticatedWebSocket {
    return {
      readyState: 1, // OPEN
      isAlive: true,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      ping: vi.fn(),
    } as unknown as AuthenticatedWebSocket;
  }

  it('tracks user connections and multi-device sockets', () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    expect(manager.isUserOnline('user-1')).toBe(false);

    manager.registerSocket(ws1, 'user-1', 'device-mobile');
    expect(manager.isUserOnline('user-1')).toBe(true);

    manager.registerSocket(ws2, 'user-1', 'device-tablet');
    const stats = manager.getOnlineStats();
    expect(stats.onlineUsers).toBe(1);
    expect(stats.totalSockets).toBe(2);

    manager.removeSocket(ws1);
    expect(manager.isUserOnline('user-1')).toBe(true);
    expect(manager.getOnlineStats().totalSockets).toBe(1);

    manager.removeSocket(ws2);
    expect(manager.isUserOnline('user-1')).toBe(false);
    expect(manager.getOnlineStats().totalSockets).toBe(0);
  });

  it('delivers notification payloads to all active sockets of a user', () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    manager.registerSocket(ws1, 'rider-77', 'phone');
    manager.registerSocket(ws2, 'rider-77', 'helmet-hud');

    const payload = { type: 'alert', message: 'Halt in 5 min' };
    const delivered = manager.sendToUser('rider-77', payload);

    expect(delivered).toBe(true);
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });
});

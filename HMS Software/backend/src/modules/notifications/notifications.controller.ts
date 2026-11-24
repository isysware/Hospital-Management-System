import type { Request, Response } from 'express';
import { notificationsService } from './notifications.service';
import { AuthenticationError, AuthorizationError } from '@/shared/errors/AppError';

function getActor(req: Request): { userId: string; role: string } {
  if (!req.user || !req.user.sub) {
    throw new AuthenticationError('Authentication required');
  }
  return { userId: req.user.sub, role: req.user.role };
}

export function getAllowedPortalsForRole(role: string): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
      return ['super-admin', 'admin', 'front-desk', 'admission', 'inventory', 'pharmacy', 'all'];
    case 'ADMIN':
      return ['admin', 'front-desk', 'admission', 'inventory', 'all'];
    case 'FRONT_DESK_BILLING':
      return ['front-desk', 'all'];
    case 'ADMISSION':
      return ['admission', 'all'];
    case 'INVENTORY_MANAGEMENT':
      return ['inventory', 'all'];
    case 'PHARMACY_SUPER_ADMIN':
    case 'PHARMACY_MANAGER':
    case 'PHARMACY_SALES_DISPENSING':
      return ['pharmacy', 'all'];
    default:
      return ['all'];
  }
}

export function getDefaultPortalForRole(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'super-admin';
    case 'ADMIN':
      return 'admin';
    case 'FRONT_DESK_BILLING':
      return 'front-desk';
    case 'ADMISSION':
      return 'admission';
    case 'INVENTORY_MANAGEMENT':
      return 'inventory';
    case 'PHARMACY_SUPER_ADMIN':
    case 'PHARMACY_MANAGER':
    case 'PHARMACY_SALES_DISPENSING':
      return 'pharmacy';
    default:
      return 'all';
  }
}

function resolveAuthorizedPortal(role: string, requestedPortal?: string): string {
  const allowed = getAllowedPortalsForRole(role);
  if (requestedPortal && requestedPortal !== 'all') {
    if (!allowed.includes(requestedPortal)) {
      throw new AuthorizationError(`Access denied: You do not have permission to access portal notifications for '${requestedPortal}'`);
    }
    return requestedPortal;
  }
  return getDefaultPortalForRole(role);
}

export const notificationsController = {
  async listNotifications(req: Request, res: Response) {
    const { userId, role } = getActor(req);
    const portal = resolveAuthorizedPortal(role, req.query.portal as string | undefined);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;

    const items = await notificationsService.listNotifications(userId, portal, limit);
    res.json({
      data: items,
    });
  },

  async getUnreadCount(req: Request, res: Response) {
    const { userId, role } = getActor(req);
    const portal = resolveAuthorizedPortal(role, req.query.portal as string | undefined);
    const count = await notificationsService.getUnreadCount(userId, portal);
    res.json({ data: { unreadCount: count } });
  },

  async markAsRead(req: Request, res: Response) {
    const { userId } = getActor(req);
    const id = req.params.id as string;
    if (!id) {
      res.status(400).json({ error: 'Notification id required' });
      return;
    }
    await notificationsService.markAsRead(id, userId);
    res.json({ success: true });
  },

  async markAllAsRead(req: Request, res: Response) {
    const { userId, role } = getActor(req);
    const requestedPortal = req.body?.portal as string | undefined;
    const portal = resolveAuthorizedPortal(role, requestedPortal);
    await notificationsService.markAllAsRead(userId, portal);
    res.json({ success: true });
  },
};

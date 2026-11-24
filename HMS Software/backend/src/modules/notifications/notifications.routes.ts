import { Router } from 'express';
import { asyncHandler } from '@/shared/asyncHandler';
import { notificationsController as c } from './notifications.controller';
import { authenticate } from '@/middleware/authenticate';

const router = Router();

// Enforce JWT authentication on all notification endpoints (§7.6, §7.8)
router.use(authenticate);

router.get('/', asyncHandler(c.listNotifications));
router.get('/unread-count', asyncHandler(c.getUnreadCount));
router.patch('/:id/read', asyncHandler(c.markAsRead));
router.post('/mark-all-read', asyncHandler(c.markAllAsRead));

export default router;

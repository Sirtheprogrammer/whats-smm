import express from 'express';
import { AdminController } from '../controllers/AdminController';
import { authMiddleware, superadminMiddleware } from '../middleware/auth';

export const createAdminRouter = (adminController: AdminController) => {
  const router = express.Router();

  // Public routes
  router.post('/login', adminController.login);

  // Protected routes
  router.use(authMiddleware);
  
  // Bot management
  router.get('/bots', adminController.getBotInstances);
  router.post('/bots', adminController.createBotInstance);
  router.post('/bots/:botId/connect', adminController.connectBot);
  router.post('/bots/:botId/disconnect', adminController.disconnectBot);
  router.put('/bots/:botId/services', adminController.updateEnabledServices);

  // Service management
  router.get('/services', adminController.getAvailableServices);

  // Superadmin only routes
  router.use(superadminMiddleware);
  // Add superadmin specific routes here

  return router;
};

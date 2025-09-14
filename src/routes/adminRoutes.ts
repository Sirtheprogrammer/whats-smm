import express from 'express';
import { adminController } from '../controllers/adminController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = express.Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);

// Service Management Routes
router.get('/services', adminController.getAllServices);
router.post('/services/sync', adminController.syncSMMServices);
router.patch('/services/:serviceId', adminController.updateServiceStatus);

// WhatsApp Connection Routes
router.get('/whatsapp/connections', adminController.getAllConnections);
router.post('/whatsapp/connections', adminController.createConnection);
router.delete('/whatsapp/connections/:id', adminController.deleteConnection);

// Dashboard Statistics
router.get('/dashboard/stats', adminController.getDashboardStats);

export default router;

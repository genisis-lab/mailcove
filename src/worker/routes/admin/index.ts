import { requireAdmin } from '../../auth/context';
import { router } from '../router';
import { adminDomainRoutes, adminMailboxRoutes } from './domains';
import {
  adminBackupRoutes,
  adminDeadLetterRoutes,
  adminLogRoutes,
  adminOverviewRoutes,
  adminProviderRoutes,
  adminSettingsRoutes,
  adminUnroutedRoutes,
} from './system';
import { adminUserRoutes } from './users';

export const adminRoutes = router();
adminRoutes.use('*', requireAdmin);
adminRoutes.route('/overview', adminOverviewRoutes);
adminRoutes.route('/users', adminUserRoutes);
adminRoutes.route('/domains', adminDomainRoutes);
adminRoutes.route('/mailboxes', adminMailboxRoutes);
adminRoutes.route('/providers', adminProviderRoutes);
adminRoutes.route('/unrouted', adminUnroutedRoutes);
adminRoutes.route('/logs', adminLogRoutes);
adminRoutes.route('/dead-letters', adminDeadLetterRoutes);
adminRoutes.route('/backups', adminBackupRoutes);
adminRoutes.route('/settings', adminSettingsRoutes);

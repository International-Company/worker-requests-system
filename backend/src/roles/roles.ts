import { Role } from '@prisma/client';

/**
 * Role catalogue. Roles are fixed in code (enforced by RolesGuard on every route);
 * "managing permissions" means assigning a role to a dashboard account.
 */
export const ROLE_DEFINITIONS: Record<Role, { label: string; permissions: string[] }> = {
  SYSTEM_ADMIN: {
    label: 'مدير النظام',
    permissions: [
      'إدارة المدراء ومديري النظام',
      'إدارة العمال وتغيير رموز الدخول',
      'فصل أجهزة المستخدمين',
      'مشاهدة جميع الطلبات والبحث فيها',
      'إدارة الإعدادات وإعدادات الإشعارات',
      'مشاهدة سجل الدخول وسجل العمليات',
    ],
  },
  MANAGER: {
    label: 'مدير',
    permissions: [
      'إدارة العمال وتغيير رموز الدخول',
      'فصل جهاز العامل',
      'إرسال الطلبات وتعديلها وإلغاؤها وإعادة إرسالها وإعادة فتحها',
      'مشاهدة طلباته فقط',
    ],
  },
  WORKER: {
    label: 'عامل',
    permissions: ['مشاهدة الطلبات المرسلة إليه', 'تأكيد الاستلام والتنفيذ'],
  },
};

import { NotificationType } from '@prisma/client';

/** Arabic notification texts (kept together so another language can be added later). */
export function notificationText(type: NotificationType, managerName: string, requestTitle: string): { title: string; body: string } {
  switch (type) {
    case NotificationType.NEW_REQUEST:
      return { title: `طلب جديد من المدير ${managerName}`, body: requestTitle };
    case NotificationType.REMINDER:
      return { title: `تذكير: طلب من المدير ${managerName} لم يُفتح بعد`, body: requestTitle };
    case NotificationType.REQUEST_UPDATED:
      return { title: 'تم تعديل الطلب', body: `${requestTitle} — من المدير ${managerName}` };
    case NotificationType.REQUEST_CANCELLED:
      return { title: 'تم إلغاء الطلب', body: requestTitle };
    case NotificationType.REQUEST_REOPENED:
      return { title: 'تمت إعادة فتح الطلب', body: `${requestTitle} — من المدير ${managerName}` };
  }
}

import { HttpStatus } from '@nestjs/common';

/**
 * Every API error carries a stable `code` (for clients) and an Arabic `message` (for users).
 * Arabic texts live here so a second language can be added later by keying on `code`.
 */
export const ERRORS = {
  VALIDATION_FAILED: { status: HttpStatus.BAD_REQUEST, message: 'البيانات المدخلة غير صحيحة' },
  INVALID_PIN: { status: HttpStatus.UNAUTHORIZED, message: 'رمز الدخول غير صحيح' },
  ACCOUNT_DISABLED: { status: HttpStatus.FORBIDDEN, message: 'الحساب غير فعال، يرجى مراجعة الإدارة' },
  UNAUTHENTICATED: { status: HttpStatus.UNAUTHORIZED, message: 'يرجى تسجيل الدخول' },
  SESSION_EXPIRED: { status: HttpStatus.UNAUTHORIZED, message: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا' },
  DEVICE_REVOKED: { status: HttpStatus.UNAUTHORIZED, message: 'تم فصل هذا الجهاز عن الحساب' },
  FORBIDDEN: { status: HttpStatus.FORBIDDEN, message: 'ليس لديك صلاحية لهذا الإجراء' },
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'العنصر المطلوب غير موجود' },
  PIN_TAKEN: { status: HttpStatus.CONFLICT, message: 'رمز الدخول مستخدم من حساب آخر، اختر رمزًا مختلفًا' },
  WORKER_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'العامل غير موجود' },
  MANAGER_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'المدير غير موجود' },
  REQUEST_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'الطلب غير موجود' },
  REQUEST_CANCELLED: { status: HttpStatus.CONFLICT, message: 'تم إلغاء هذا الطلب' },
  NO_ACTIVE_RECIPIENTS: { status: HttpStatus.BAD_REQUEST, message: 'لا يوجد عمال فعالون لإرسال الطلب إليهم' },
  INVALID_RECIPIENTS: { status: HttpStatus.BAD_REQUEST, message: 'بعض العمال المحددين غير موجودين أو غير فعالين' },
  MUST_ACKNOWLEDGE_FIRST: { status: HttpStatus.CONFLICT, message: 'يجب الضغط على "تم الاستلام" أولًا' },
  STALE_STATE: { status: HttpStatus.CONFLICT, message: 'تم تغيير حالة الطلب من الإدارة قبل مزامنة العملية، تم تحديث الطلب' },
  CANNOT_REOPEN: { status: HttpStatus.CONFLICT, message: 'يمكن إعادة فتح الطلبات المنفذة فقط' },
  ALREADY_COMPLETED: { status: HttpStatus.CONFLICT, message: 'تم تنفيذ هذا الطلب مسبقًا' },
  TOO_MANY_IMAGES: { status: HttpStatus.BAD_REQUEST, message: 'الحد الأقصى 3 صور للطلب الواحد' },
  INVALID_IMAGE: { status: HttpStatus.BAD_REQUEST, message: 'الملف ليس صورة صالحة. الصيغ المسموحة: JPG, PNG, WEBP' },
  IMAGE_TOO_LARGE: { status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'حجم الصورة أكبر من المسموح' },
  ATTACHMENT_NOT_AVAILABLE: { status: HttpStatus.BAD_REQUEST, message: 'إحدى الصور غير متاحة، أعد رفعها' },
  IDEMPOTENCY_CONFLICT: { status: HttpStatus.CONFLICT, message: 'تم استخدام معرف الإرسال لطلب مختلف' },
  CANNOT_MODIFY_SELF: { status: HttpStatus.BAD_REQUEST, message: 'لا يمكنك تعطيل أو حذف حسابك الحالي' },
  LAST_ADMIN: { status: HttpStatus.BAD_REQUEST, message: 'يجب أن يبقى مدير نظام فعال واحد على الأقل' },
  INVALID_SETTING: { status: HttpStatus.BAD_REQUEST, message: 'قيمة الإعداد غير صالحة' },
  TOO_MANY_REQUESTS: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'محاولات كثيرة، يرجى الانتظار قليلًا ثم المحاولة مجددًا' },
  INTERNAL: { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'حدث خطأ غير متوقع، حاول مرة أخرى' },
} as const;

export type ErrorCode = keyof typeof ERRORS;

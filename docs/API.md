# REST API

التوثيق التفاعلي الكامل (OpenAPI/Swagger): **`/api/docs`** (مفعّل في التطوير، وفي الإنتاج عبر `ENABLE_SWAGGER=true`).

**قواعد عامة**
- كل المسارات تحت `/api`.
- المصادقة: Cookie الجلسة `wr_session` (تُضبط عند `POST /api/auth/login`).
- كل طلب يغيّر البيانات يحتاج الترويسة `X-Requested-With: XMLHttpRequest`.
- الأخطاء بصيغة `{ statusCode, code, message, details? }` مع `message` بالعربية.

| Method | Path | الدور | الوصف |
|---|---|---|---|
| POST | `/auth/login` | عام | `{ pin, deviceKey, deviceLabel? }` — دخول + ربط الجهاز |
| POST | `/auth/logout` | الكل | إنهاء الجلسة (العامل: فصل الجهاز أيضًا) |
| GET | `/auth/me` | الكل | المستخدم الحالي |
| GET | `/dashboard/stats` | مدير، مدير نظام | إحصائيات لوحة التحكم |
| GET | `/workers` | مدير، مدير نظام | قائمة العمال مع الاتصال والجهاز |
| POST | `/workers` | مدير، مدير نظام | إضافة عامل |
| PATCH | `/workers/:id` | مدير، مدير نظام | تعديل / تعطيل / تفعيل |
| POST | `/workers/:id/change-pin` | مدير، مدير نظام | تغيير PIN |
| POST | `/workers/:id/disconnect-device` | مدير، مدير نظام | فصل الجهاز |
| PUT / GET | `/workers/:id/photo` | — | رفع / عرض الصورة (محمي) |
| DELETE | `/workers/:id` | مدير نظام | حذف ناعم |
| GET / POST | `/managers` | مدير نظام | قائمة / إضافة مدير أو مدير نظام |
| PATCH / DELETE | `/managers/:id` | مدير نظام | تعديل الاسم، الدور، الحالة / حذف ناعم |
| POST | `/managers/:id/change-pin` · `/managers/:id/disconnect-device` | مدير نظام | |
| POST | `/attachments` | مدير | رفع صورة (`file`, `clientUploadId`) — idempotent |
| GET | `/attachments/:id?variant=full\|thumb` | حسب الصلاحية | عرض صورة محمية |
| GET | `/requests` | مدير (طلباته)، مدير نظام (الكل) | بحث: `q, workerId, managerId, status, from, to, view, page, pageSize` |
| POST | `/requests` | مدير | `{ idempotencyKey, title, targetType, workerIds?, attachmentIds? }` |
| GET | `/requests/:id` | مدير، مدير نظام | التفاصيل + الأوقات + سجل الإشعارات |
| PATCH | `/requests/:id` | مدير (المنشئ) | `{ title?, attachmentIds? }` |
| POST | `/requests/:id/cancel` | مدير (المنشئ) | إلغاء |
| POST | `/requests/:id/resend` | مدير (المنشئ) | `{ idempotencyKey }` ينشئ طلبًا جديدًا |
| POST | `/requests/:id/reopen` | مدير (المنشئ) | `{ recipientIds? }` |
| GET | `/worker/requests?since=` | عامل | المزامنة (كاملة / تزايدية) |
| POST | `/worker/requests/:recipientId/open` | عامل | تسجيل الفتح |
| POST | `/worker/requests/:recipientId/acknowledge` | عامل | `{ baseStateVersion?, clientActionAt?, opId? }` |
| POST | `/worker/requests/:recipientId/complete` | عامل | نفس الجسم |
| GET | `/push/status` | الكل | حالة الإشعارات + المفتاح العام VAPID |
| POST / DELETE | `/push/subscribe` | عامل | حفظ / إزالة اشتراك Web Push |
| POST | `/notifications/:id/delivered` | عامل | إيصال تسليم من الـService Worker |
| POST | `/presence/heartbeat` | عامل | `{ visible }` |
| GET / PATCH | `/settings` | مدير نظام | الإعدادات |
| GET | `/roles` | مدير نظام | الأدوار وصلاحياتها |
| GET | `/logs/logins` · `/logs/audit` | مدير نظام | سجل الدخول · سجل العمليات |
| GET | `/events/stream` | مدير، مدير نظام | Server-Sent Events للتحديث اللحظي |
| GET | `/health` | عام | فحص الصحة |

> المسارات المقترحة في المتطلبات `POST /requests/:id/acknowledge` و`/complete` موجودة تحت `/worker/requests/:recipientId/...`، لأن الحالة مستقلة لكل عامل. المعرّف هو نسخة العامل من الطلب وليس الطلب كله.

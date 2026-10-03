# نظام طلبات وتواصل العمال

نظام ويب (PWA) يتيح للمدراء إرسال طلبات سريعة (عنوان + حتى 3 صور) إلى عامل أو عدة عمال أو جميع العمال، ويستقبلها العامل على هاتفه كإشعار (Web Push) مع صوت واهتزاز قدر ما يسمح به المتصفح ونظام التشغيل، ثم يضغط **تم الاستلام** ثم **تم التنفيذ**، ويتابع المدير الحالة لحظيًا لكل عامل على حدة.

- تطبيق واحد (PWA) لكل الأدوار: **مدير النظام**، **مدير**، **عامل** — عربي بالكامل، RTL، وضع فاتح فقط.
- لا يوجد تطبيق Android أو iOS أصلي — العمال يثبتون الـPWA من المتصفح.

| المكون | التقنية |
|---|---|
| Backend | Node.js 22 · NestJS 11 · TypeScript · Prisma 6 |
| Database | PostgreSQL (الصور مخزنة داخلها كـ BYTEA بعد الضغط) |
| Frontend | React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · PWA (Workbox، Service Worker مخصص) |
| Offline | IndexedDB (Dexie) + Sync Queue + Background Sync |
| Push | Web Push القياسي (VAPID) — لا يحتاج Firebase |
| Hosting | Railway (خدمة واحدة + PostgreSQL) |

## هيكل المستودع

```
app/
├─ backend/                 NestJS API (يخدم أيضًا ملفات الـPWA بعد البناء)
│  ├─ prisma/               schema.prisma · migrations/ · seed.dev.ts
│  ├─ src/                  وحدات NestJS (انظر docs/ARCHITECTURE.md)
│  ├─ test/                 اختبارات e2e على PostgreSQL حقيقي داخل الذاكرة (PGlite)
│  └─ scripts/              verify-migrations.mjs
├─ web/                     React PWA
│  ├─ src/sw.ts             Service Worker (Push · Notification click · Offline · Background Sync)
│  ├─ src/offline/          IndexedDB · طابور العامل · صندوق صادر المدير
│  ├─ src/worker/           واجهة العامل (Mobile First)
│  ├─ src/staff/            لوحة المدير ومدير النظام
│  └─ public/               الأيقونات وصوت التنبيه
├─ e2e/                     اختبار متصفح حقيقي (Chrome) على النظام الكامل
├─ docs/                    التوثيق
├─ Dockerfile · railway.json
└─ README.md
```

## التشغيل محليًا

المتطلبات: Node.js 20.11+ (مُختبر على 22 و24)، وقاعدة PostgreSQL (يمكن استخدام قاعدة Railway نفسها عبر الرابط العام — انظر [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#قاعدة-بيانات-للتطوير)).

### 1) Backend

```bash
cd backend
npm install
cp .env.example .env          # ثم عدّل DATABASE_URL و AUTH_SECRET
npm run vapid:generate        # انسخ المفتاحين إلى VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY في .env
npx prisma migrate deploy     # إنشاء الجداول
npm run seed:dev              # بيانات تطوير فقط (انظر الجدول أدناه)
npm run start:dev             # http://localhost:3000  ·  Swagger: http://localhost:3000/api/docs
```

### 2) Frontend

```bash
cd web
npm install
npm run dev                   # http://localhost:5173  (يمرر /api إلى الـBackend على 3000)
```

> الـService Worker والإشعارات تعمل في نسخة الإنتاج فقط. للتجربة الكاملة محليًا:
> `cd web && npm run build` ثم شغّل الـBackend وافتح http://localhost:3000 (الـBackend يخدم `web/dist`).
> `localhost` يُعامل كاتصال آمن، أما على الهاتف فيجب HTTPS (Railway يوفره تلقائيًا).

### بيانات التطوير (Development فقط)

| الحساب | الدور | رمز الدخول |
|---|---|---|
| مدير النظام (تجريبي) | مدير النظام | `1000` |
| المدير محمد (تجريبي) | مدير | `2000` |
| أحمد (عامل تجريبي) | عامل | `3001` |
| محمود (عامل تجريبي) | عامل | `3002` |

سكربت الـseed يرفض العمل عند `NODE_ENV=production`. في الإنتاج يُنشأ أول مدير نظام عبر `npm run bootstrap:admin` (انظر DEPLOYMENT).

## الاختبارات

```bash
cd backend && npm test               # 118 اختبار: unit + e2e على PostgreSQL حقيقي (PGlite) — بدون قاعدة محلية
cd backend && npm run test:migrations
cd web && npm test                   # Vitest: الطابور Offline، صندوق الصادر، API client، المكونات
cd web && npm run build              # فحص TypeScript + بناء الـPWA
cd e2e && npm install && npm test    # متصفح Chrome حقيقي على النظام الكامل (يتطلب بناء backend و web)
```

التفاصيل في [docs/TESTING.md](docs/TESTING.md).

## التوثيق

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — البنية، قاعدة البيانات، المصادقة، دورة الطلب، الإشعارات، الـOffline (مع مخططات)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — النشر على Railway خطوة بخطوة، المتغيرات، الـmigrations
- [docs/WEB_PUSH.md](docs/WEB_PUSH.md) — إعداد الإشعارات (VAPID)، ولماذا لا نحتاج Firebase، وقيود Android/iOS الحقيقية
- [docs/TESTING.md](docs/TESTING.md) — الاختبارات وقائمة الفحص اليدوي على الهواتف
- [docs/API.md](docs/API.md) — ملخص الـREST API (التوثيق التفاعلي في `/api/docs`)

## الأمان باختصار

- رمز الدخول (PIN) لا يُخزن ولا يُسجل نصًا: يُخزن HMAC-SHA256 بمفتاح سري على الخادم، وفريد على مستوى النظام.
- جلسات من جهة الخادم في Cookie من نوع `httpOnly` + `Secure` + `SameSite=Strict` — لا توجد أي tokens في JavaScript أو localStorage.
- حماية CSRF: SameSite=Strict + ترويسة مطلوبة `X-Requested-With` + فحص Origin.
- صلاحيات RBAC على كل endpoint ("ممنوع افتراضيًا")، والمدير لا يرى طلبات غيره.
- تحديد معدل المحاولات لتسجيل الدخول (10/دقيقة و60/ساعة لكل IP) دون قفل الحسابات.
- الصور: فحص المحتوى الحقيقي (وليس الامتداد)، حد للحجم والأبعاد، إزالة بيانات EXIF/GPS، وإعادة الترميز إلى WebP، ولا تُعرض إلا لمستخدم مصرح له.
- سجل العمليات وسجل الدخول غير قابلين للتعديل أو الحذف حتى من قاعدة البيانات (Trigger).
- HTTPS إجباري في الإنتاج + HSTS + CSP صارم.

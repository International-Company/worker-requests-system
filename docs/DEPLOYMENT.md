# النشر على Railway

البنية على Railway: **خدمتان فقط** داخل مشروع واحد.

| الخدمة | المصدر | ملاحظات |
|---|---|---|
| `app` | هذا المستودع (GitHub) | `Dockerfile` في الجذر يبني الـPWA والـBackend في صورة واحدة. NestJS يقدم `/api` والواجهة من نفس النطاق |
| `Postgres` | Railway PostgreSQL | قاعدة البيانات (البيانات + الصور) |

> لماذا لا توجد خدمة منفصلة للواجهة؟ وجود الواجهة والـAPI على نفس النطاق يسمح بـCookie آمن `SameSite=Strict` بدون CORS، ويجعل نطاق الـService Worker والإشعارات بسيطًا. وهذه أيضًا خدمة واحدة أقل تكلفة.

## الخطوات

1. **ارفع المستودع إلى GitHub** (ملف `.gitignore` يمنع رفع `.env` والأسرار):
   ```bash
   git remote add origin https://github.com/<org>/<repo>.git
   git push -u origin main
   ```
2. في Railway: **New Project → Deploy from GitHub repo** واختر المستودع. سيكتشف `railway.json` ويستخدم الـDockerfile.
3. في نفس المشروع: **New → Database → PostgreSQL**.
4. في خدمة `app` ← **Variables** أضف:

   | المتغير | القيمة |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (مرجع Railway) |
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://<اسم-الخدمة>.up.railway.app` (أو نطاقك) |
   | `AUTH_SECRET` | سلسلة عشوائية ≥ 32 حرفًا (انظر الأمر أدناه) |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | من `npm run vapid:generate` |
   | `VAPID_SUBJECT` | `mailto:it@your-company.com` |
   | `TZ` | `Asia/Riyadh` (أو منطقتك، لعدادات «اليوم») |

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   > ⚠ `AUTH_SECRET` يُستخدم لتشفير الـPIN. تغييره لاحقًا يبطل كل رموز الدخول والجلسات.
5. **Settings → Networking → Generate Domain** (أو أضف نطاقًا مخصصًا). Railway يوفر HTTPS تلقائيًا، وهو **ضروري** للـPWA والإشعارات. حدّث `APP_URL` ليطابق النطاق تمامًا.
6. انشر (Deploy). عند كل تشغيل تُطبق الـmigrations تلقائيًا (`prisma migrate deploy` في أمر التشغيل) ثم يبدأ الخادم. فحص الصحة على `/api/health`.
7. **أنشئ أول مدير نظام** (مرة واحدة). من **Railway CLI** على جهازك:
   ```bash
   railway link
   railway run --service app sh -c 'BOOTSTRAP_ADMIN_NAME="مدير النظام" BOOTSTRAP_ADMIN_PIN=4821 npm run bootstrap:admin'
   ```
   أو أضف المتغيرين مؤقتًا في Variables ونفّذ `npm run bootstrap:admin` من «Shell» في Railway، ثم **احذفهما**. الأمر لا يفعل شيئًا إذا كان هناك مدير نظام فعال.
8. افتح الرابط، وسجل الدخول بالـPIN، وأضف المدراء والعمال.

## أوامر البناء والتشغيل (للمرجع)

| | الأمر |
|---|---|
| Build (Dockerfile) | `web: npm ci && npm run build` · `backend: npm ci && prisma generate && nest build` |
| Start | `npx prisma migrate deploy && node dist/main.js` |
| Migrations يدويًا | `cd backend && DATABASE_URL=... npx prisma migrate deploy` |
| حالة الـmigrations | `npx prisma migrate status` |
| Health check | `GET /api/health` → `{ "status": "ok" }` |

## Migrations

- الملفات في `backend/prisma/migrations/`. تُطبق تلقائيًا عند كل نشر (آمن للتكرار).
- لإضافة تغيير على المخطط أثناء التطوير: عدّل `schema.prisma` ثم `npx prisma migrate dev --name <وصف>` (على قاعدة تطوير)، وارفع مجلد الـmigration الجديد مع الكود.
- لا تعدّل migration تم تطبيقها في الإنتاج. أنشئ migration جديدة.

## قاعدة بيانات للتطوير

لا تحتاج PostgreSQL محليًا:
- **الأفضل**: أنشئ **Environment** منفصلة في Railway (مثل `development`) بقاعدة خاصة بها، واستخدم **رابطها العام** (Postgres ← Connect ← *Public Network*) في `backend/.env` المحلي.
- لا تشغّل `npm run seed:dev` على قاعدة الإنتاج (السكربت يرفض عند `NODE_ENV=production`).
- الاختبارات الآلية لا تحتاج أي قاعدة خارجية (تستخدم PostgreSQL داخل الذاكرة).

## ملاحظات تشغيلية

- **نسخة واحدة** (`numReplicas: 1`): المهام الخلفية (التذكير، إعادة المحاولة) والبث اللحظي (SSE) مصممة لنسخة واحدة، وهي تكفي لمئات العمال. للتوسع الأفقي لاحقًا: Postgres advisory locks للمهام، وLISTEN/NOTIFY أو Redis للبث.
- **النسخ الاحتياطي**: فعّل Backups لقاعدة PostgreSQL في Railway، فالصور مخزنة داخلها.
- **حجم القاعدة**: الصورة بعد الضغط حوالي 100–250 KB، والمصغرة حوالي 15–30 KB. الصور التي رُفعت ولم تُستخدم تُحذف بعد 24 ساعة.
- **السجلات (Logs)**: أخطاء 5xx تُسجل مع stack trace في سجلات Railway، ولا تظهر للمستخدم. الـPIN لا يُسجل أبدًا.
- **Swagger** معطل في الإنتاج افتراضيًا (`ENABLE_SWAGGER=true` لتفعيله).

# مسار | Masar CRM

متابعة العملاء العقاريين لشركات المبيعات في مصر والسعودية. مسار العمل الأساسي: توزيع العميل تلقائيًا، إنشاء متابعة إلزامية، إرسال تذكير عند موعدها، ثم تصعيدها إلى المدير إذا بقيت متأخرة.

## البدء محليًا

1. ثبّت اعتماديات المشروع: `npm install`.
2. انسخ `.env.example` إلى `.env.local`.
3. ابدأ Supabase: `npm run db:start`، ثم انسخ `API URL` و`anon key` من `npx supabase status` إلى `.env.local`.
4. طبّق الترحيلات والبيانات الأولية: `npm run db:reset`.
5. شغّل التطبيق: `npm run dev`، وافتح `http://localhost:3000`.

يدعم تسجيل البريد الإلكتروني تأكيد الحساب عبر `/[locale]/auth/callback`. اضبط `NEXT_PUBLIC_SITE_URL` على عنوان التطبيق وأضف مسار callback إلى قائمة إعادة التوجيه المسموح بها في إعدادات Supabase Auth عند النشر.

## النشر على Vercel

- استورد مستودع GitHub `mammgmm8/crmm` إلى Vercel، واجعل **Root Directory** هو `crm-main`. Next.js يحدد إطار العمل وأوامر البناء تلقائيًا.
- أضف متغيرات `.env.example` في إعدادات Vercel لكل بيئة منشورة. بعد أول نشر، غيّر `NEXT_PUBLIC_SITE_URL` إلى عنوان `https://<your-app>.vercel.app` الذي خصصه Vercel، ثم أعد النشر.
- أضف `https://<your-app>.vercel.app/**` إلى **Supabase → Authentication → URL Configuration → Redirect URLs**، واجعل رابط التطبيق نفسه **Site URL**.
- أضف `NEXT_PUBLIC_VAPID_PUBLIC_KEY` إلى Vercel من قيمة `.env.local` المحلية. المفتاح الخاص `VAPID_PRIVATE_KEY`، و`WORKFLOW_CRON_SECRET`، و`RESEND_API_KEY` تبقى أسرارا في Supabase ولا توضع في Vercel أو Git.
- نطاق `vercel.app` مجاني للاستضافة؛ راجع شروط الخطة الحالية قبل استخدام خطة مجانية لنظام أعمال تجاري.
- بعد رفع آخر commit على GitHub، ينشر Vercel تلقائيًا من الفرع المرتبط. لا ترفع `.env.local` أو ملف الأسرار المؤقت.

واجهة السيلز تعمل كتطبيق PWA قابل للتثبيت. لا تُخزّن الصفحات المحمية دون اتصال؛ تحفظ التفاعلات غير المتصلة محليًا وتزامنها عند عودة الشبكة. يتطلب Web Push اتصال HTTPS (أو localhost) وموافقة المستخدم من شاشة «اليوم».

## قاعدة البيانات والأمان

- ترحيل المخطط وRLS: `supabase/migrations/20260930000000_initial_schema.sql`.
- المؤسسة التجريبية وإعدادات مصر الافتراضية: `supabase/seed.sql`.
- اختبارات العزل والصلاحيات: `supabase/tests/rls.test.sql`، وتشغّل عبر `npm run test:rls` بعد بدء Supabase.
- اختبارات سير العمل: `supabase/tests/workflow.test.sql`، وتشغّل عبر `npm run test:workflow` بعد بدء Supabase.
- اختبارات تقرير الأثر والبيانات التجريبية: `supabase/tests/impact-report.test.sql`، وتشغّل عبر `npm run test:impact` بعد بدء Supabase.
- جميع الأوقات `timestamptz` بتوقيت UTC؛ المنطقة الزمنية تُطبّق عند عرض المواعيد وحساب مهام اليوم.
- صلاحيات المستخدمين تُقرأ من `memberships` وتُطبّقها RLS. لا يُستخدم مفتاح `service_role` في المتصفح؛ مسارات الفوترة server-only تستخدمه لمعالجة الدفع بعد التحقق من هوية المدير أو توقيع TruePay.
- استدعاء `create_lead` ينشئ سجل التدقيق ومهمة المتابعة ضمن معاملة واحدة. يرسل `pg_cron` تذكيرًا عند الاستحقاق ويصعّد المهمة بعد المهلة المحددة إلى مدير المؤسسة.
- يعمل عامل `workflow-worker` عبر `pg_cron` كل دقيقة؛ انشر الدالة واضبط `WORKFLOW_CRON_SECRET` ثم خزّن عنوان الدالة والسر نفسه في Vault عبر `configure_workflow_edge_runtime` بصلاحية `service_role`.
- يلتقط العامل خط أساس العملاء خلال أول 7 أيام، ويحفظه بعد اكتمال مهلة 24 ساعة لعملاء آخر يوم. تُنسب النجاة للتذكير أو التصعيد الأخير السابق لأول استجابة فقط، ويصدر التقرير أسبوعيًا بعد اكتمال الأسبوع.
- انشر العامل واضبط بريد التقارير (تحقق من نطاق المرسل في Resend أولًا):

```bash
supabase functions deploy workflow-worker
supabase secrets set WORKFLOW_CRON_SECRET='<same-vault-secret>' RESEND_API_KEY='<resend-api-key>' IMPACT_REPORT_FROM_EMAIL='Masar Reports <reports@example.com>'
```

- فعّل الفوترة بتطبيق migrations ثم انشر عامل التذكيرات. أنشئ نطاق إرسال موثقًا لدى Resend واضبط أسرار Edge Function:

```bash
supabase db push
supabase functions deploy workflow-worker
supabase secrets set BILLING_FROM_EMAIL='Masar Billing <billing@your-verified-domain.com>' BILLING_SITE_URL='https://mcr-sandy.vercel.app' BILLING_CRON_SECRET='<same-long-random-secret-as-vercel>'
```

- أضف في Vercel كمتغيرات server-only `SUPABASE_SERVICE_ROLE_KEY`, `TRUEPAY_API_KEY`, `TRUEPAY_SECRET_KEY`, و`BILLING_CRON_SECRET`، مع `PAYMENT_PROVIDER=truepay`. استخدم قيمة `BILLING_CRON_SECRET` نفسها في Vercel وSupabase Secrets؛ لا تضف أيًا من هذه المفاتيح إلى `NEXT_PUBLIC_*` أو Git. عيّن callback في TruePay إلى `https://mcr-sandy.vercel.app/api/billing/webhooks/truepay`.
- الباقات والأسعار وحدودها تُدار من جدول `billing_plans`; السنة تحسب بسعر 10 أشهر. التجربة 14 يومًا دون بطاقة، وبعد انتهاء الفترة توجد مهلة 7 أيام قبل وضع القراءة فقط، ولا تُحذف بيانات المؤسسة.
- TruePay مفعّل حاليًا لـ EGP فقط بحسب الوثائق المتاحة. لا يوجد auto-charge، وواجهة refund ترجع رفضًا صريحًا إلى أن يوثق المزود endpoint رسميًا. أسعار SAR موجودة في الكتالوج لكن checkout معطل حتى إضافة/تأكيد مزود يدعمها.
- تذكيرات التجديد عند 5 و2 و0 أيام تصل إلى مالك المؤسسة عبر Resend. رابط الرسالة يفتح صفحة الفوترة حيث يبدأ المدير الدفع يدويًا.

- لتفعيل تذكيرات المهام بالبريد وWeb Push، أنشئ مفاتيح VAPID عبر `npx --yes web-push@3.6.7 generate-vapid-keys --json`. أضف المفتاح العام بشكل دائم إلى `.env.local` ثم أعد تشغيل Next.js. أرسل بقية الأسرار وعنوان المرسل الموثق إلى Supabase:

```bash
supabase secrets set VAPID_PUBLIC_KEY='<vapid-public-key>' VAPID_PRIVATE_KEY='<vapid-private-key>' VAPID_SUBJECT='mailto:notifications@example.com' REMINDER_FROM_EMAIL='Masar Reminders <reminders@example.com>'
```

- يختار مندوب المبيعات «تفعيل تذكيرات المتصفح» مرة واحدة. يرسل العامل المجدول تذكير المهمة إلى البريد المسجل، ويرسل Push للأجهزة التي وافقت؛ يعيد المحاولة تلقائيًا ويحذف اشتراكات Push المنتهية.

- يرسل التقرير الأسبوعي بصيغة PDF إلى مالك المؤسسة. أدخل متوسط قيمة الصفقة ومعدل الإغلاق من إعدادات المؤسسة؛ الإيراد المحمي تقدير وليس إيرادًا محققًا.
- استقبال العملاء اليدوي وCSV/XLSX والويبهوك يمر عبر مسار إنشاء موحد؛ تُحوّل أرقام مصر والسعودية إلى E.164 وتُفحص التكرارات داخل المؤسسة مع تسجيل `lead.created` أو `lead.duplicate_detected` في `lead_events`.
- عند إنشاء المؤسسة تُجهّز مراحل العقار وقواعد التوزيع والمتابعة والتصعيد تلقائيًا. تعرض لوحة المدير checklist دائمًا: دعوة sales برابط لمرة واحدة وصلاحية 7 أيام، استيراد CSV بمطابقة الأعمدة الذكية أو إضافة أول lead يدويًا، ثم تأكيد التوزيع. يفتح حساب sales شاشة Today مباشرة بعد قبول الدعوة.
- اختبر دعوات الانضمام عبر `npm run test:onboarding` بعد تشغيل Supabase المحلي.

## استقبال العملاء

- استيراد CSV أو XLSX متاح للمالك والمدير من زر «استيراد العملاء». يُقرأ الملف خادميًا (حد 5 MiB و500 صف)، وتُقترح مطابقة الأعمدة العربية والإنجليزية مع معاينة قابلة للتعديل قبل الإرسال.
- لإصدار سر المؤسسة أو تدويره، افتح الإعدادات ثم «استقبال العملاء عبر webhook». يظهر السر مرة واحدة فقط؛ تدويره يبطل السابق.
- endpoint: `POST /api/webhooks/leads/{organizationId}`.
- أرسل السر في الترويسة `x-masar-webhook-secret`، وحقلي `name` و`phone` في JSON. الحقول الاختيارية: `email`, `source`, `property_interest`.

```bash
curl -X POST 'https://app.example.com/api/webhooks/leads/<organization-id>' \
	-H 'content-type: application/json' \
	-H 'x-masar-webhook-secret: <organization-secret>' \
	-d '{"name":"Ahmed Ali","phone":"01012345678","source":"website"}'
```

- يقبل endpoint جسمًا حتى 64 KiB ويعيد `201` للعميل الجديد أو `200` للتكرار (`{"id":"...","duplicate":true}`).
- تقبل أرقام مصر والسعودية بصيغها المحلية والدولية، بما فيها الأرقام العربية الهندية، وتُخزّن بعد تحويلها إلى E.164. يستخدم كشف التكرار الرقم المطبع ويُسجل محاولات التكرار في `lead_events`.
- أسماء الأعمدة الشائعة مثل «اسم العميل» و«رقم الجوال» و`Lead Name` و`Mobile Number` تُطابق تلقائيًا؛ راجع المعاينة قبل استيراد حتى 500 سجل.

## التحقق

- `npm run lint`
- `npm run build`
- `npm run test:rls`
- `npm run test:workflow`
- `npm run test:impact`
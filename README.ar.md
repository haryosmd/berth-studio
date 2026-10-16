<div dir="rtl">

<h1 align="center">Berth Studio</h1>

<p align="center">
  تطبيق واحد لقواعد بياناتك وواجهاتك البرمجية (API).<br>
  خفيف وسريع، وحريص جدًا على أسرارك.
</p>

<p align="center">
  🇬🇧 <a href="README.md">English</a> ·
  🇮🇩 <a href="README.id.md">Bahasa Indonesia</a> ·
  🇨🇳 <a href="README.zh-CN.md">简体中文</a> ·
  🇯🇵 <a href="README.ja.md">日本語</a> ·
  🇸🇦 <b>العربية</b> ·
  🇷🇺 <a href="README.ru.md">Русский</a>
</p>

> **تنبيه:** ما زال Berth Studio في بداية التطوير. يمكن [تنزيل](https://github.com/haryosmd/berth-studio/releases/latest) تطبيق macOS، وهو يتصل بـ PostgreSQL وMongoDB. ويُظهر النموذج الأولي التفاعلي الوجهة التي يسير إليها.

## لماذا Berth Studio؟

إذا كنت تعمل على الواجهات الخلفية (backend)، فيومك غالبًا يبدو هكذا:

- DBeaver مفتوح لقاعدة البيانات؛
- وPostman مفتوح للـ API؛
- وملف ملاحظات مليء بسلاسل الاتصال لبيئات dev وstaging وprod.

يجمع Berth Studio كل ذلك في نافذة واحدة، ويتعامل مع بيئة الإنتاج بالحذر الذي تستحقه.

## ماذا يقدّم

- **قواعد البيانات:** يدعم PostgreSQL وMongoDB وSupabase وFirebase. تصفّح الجداول، وعدّل الصفوف، ونفّذ الاستعلامات، واستعرض المستندات.
- **dev وstaging وprod:**
  - لكل اتصال ملف إعدادات (profile) واحد في كل بيئة، ولكل ملف مضيفه وبيانات دخوله الخاصة.
  - يسمّي فريقك بيئاته كما يشاء (local وqa وprod-eu وغيرها)، ويمكن تثبيت كل تبويب على بيئته الخاصة لمقارنة بيئتين جنبًا إلى جنب.
  - إذا لم يكن الاتصال موجودًا في تلك البيئة، يخبرك Berth Studio بذلك بوضوح بدلًا من التخمين.
- **قاعدة للقراءة وأخرى للكتابة:**
  - يمكن أن يضم ملف الإعدادات خادمًا رئيسيًا (primary) ونسخًا للقراءة (read replicas).
  - تذهب استعلامات القراءة تلقائيًا إلى النسخة، وتبقى الكتابة دائمًا على الخادم الرئيسي.
  - ويمكنك أيضًا تثبيت الاستعلام على أيٍّ منهما يدويًا، أما ملف الإعدادات الذي لا يضم إلا نسخًا للقراءة فلا يكتب أبدًا.
- **API Collections:** تُحفظ الطلبات داخل مجلدات متداخلة بأي عمق، تمامًا مثل شجرة الملفات في VS Code. ويمكنك الاستيراد من Postman وInsomnia وOpenAPI وHAR وBruno وcURL.
- **ERD:** ارسم المخططات من البنية الفعلية لقاعدة البيانات، أو ارسم جداول جديدة بحرية.
- **شبكات أمان:**
  - تُفتح بيئة الإنتاج للقراءة فقط.
  - كل تعديل في الجدول يعرض أمر SQL قبل تنفيذه.
  - للكتابة في بيئة الإنتاج، عليك أولًا كتابة اسم الاتصال.
- **الأسرار:** تبقى كلمات المرور والرموز (tokens) في سلسلة مفاتيح النظام. لا تُحفظ أبدًا في ملفات مساحة العمل، ولا تظهر في الواجهة.
- **التحديثات:** عند صدور نسخة جديدة تظهر أيقونة في أعلى اليمين. بنقرة واحدة يُنزَّل التحديث، ولا يثبّته التطبيق إلا إذا تحقّق من صحة توقيعه.

## جرّبه

### نزّل التطبيق (macOS)

احصل على أحدث ملف `.dmg` من [صفحة الإصدارات](https://github.com/haryosmd/berth-studio/releases/latest). بناء واحد يعمل على أجهزة Mac بمعالجات Apple silicon وIntel معًا. افتح ملف `.dmg` واسحب Berth Studio إلى مجلد التطبيقات.

لم يُوقَّع التطبيق بعد بمعرّف Apple Developer ID، لذا يمنع macOS تشغيله في المرة الأولى. افتح **إعدادات النظام ← الخصوصية والأمان**، ثم مرّر للأسفل واختر **فتح على أي حال**. تصل الإصدارات اللاحقة عبر أداة التحديث داخل التطبيق، التي لا تثبّت أي تحديث إلا إذا صحّ توقيعه.

### شغّله من الشيفرة المصدرية (macOS)

تحتاج إلى Rust (عبر `rustup`) وNode.js 20 أو أحدث وأدوات سطر أوامر Xcode. يستغرق البناء الأول بضع دقائق. يشغّل الأمر الثاني قاعدة PostgreSQL مؤقتة فيها بيانات تجريبية على `127.0.0.1:54329` (المستخدم `app` وكلمة المرور `berth-dev-app`، ويحذفها `scripts/dev-db/stop.sh`). ولتجربة MongoDB، ثبّت `mongodb-community@8.0` من Homebrew ثم شغّل `scripts/dev-db/mongo-start.sh`، فتعمل مجموعة نسخ (replica set) مؤقتة على `127.0.0.1:54330` (المستخدم `app` وكلمة المرور `berth-dev-app` وقاعدة المصادقة `events`).

```bash
npm ci
scripts/dev-db/start.sh
npm run tauri dev
```

### الاتصال بقاعدة بيانات في السحابة

قواعد البيانات المُدارة مثل Amazon RDS وAurora وAzure Database وGoogle Cloud SQL وDigitalOcean توقّع شهادات خوادمها بسلطة شهادات (CA) خاصة بالمزوّد، ولا يثق بها macOS افتراضيًا. يتحقق Berth Studio من الشهادة على أي حال، لذا يفشل اختبار الاتصال برسالة `invalid peer certificate: UnknownIssuer` إلى أن تزوّده بشهادة CA الخاصة بالمزوّد.

1. نزّل شهادة CA (ملف `.pem`) من مزوّدك. تجدها عادةً في صفحة الاتصال بقاعدة البيانات باسم "CA certificate" أو "root certificate" أو "SSL certificate":
   - **Amazon RDS وAurora:** حزمة لكل منطقة، أو الحزمة العالمية، من [مخزن الثقة الخاص بـ RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
   - **Azure Database for PostgreSQL:** الشهادات الجذرية المذكورة في [وثائق TLS](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls).
   - **Google Cloud SQL:** شهادة CA الخاصة بالخادم في صفحة **Connections** للمثيل، انظر [الوثائق](https://cloud.google.com/sql/docs/postgres/configure-ssl-instance).
   - **DigitalOcean:** شهادة CA في صفحة **Overview** لقاعدة البيانات، انظر [الوثائق](https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/).
2. في نافذة اتصال PostgreSQL، ضع مسار الملف في حقل **CA certificate** ضمن ملف تعريف تلك البيئة. يمكن أن يبدأ المسار بـ `~`.
3. اضغط **Test**. يُقرأ الملف عند كل اتصال، فاتركه في مكانه.

يضيف ملف CA إلى مخزن ثقة النظام ولا يستبدله. قواعد البيانات على جهازك أو التي أُوقف فيها TLS لا تحتاج إليه.

### افتح النموذج الأولي

النموذج الأولي ملف HTML واحد فيه بيانات تجريبية، ولا يتصل بأي قاعدة بيانات حقيقية.

```bash
open design/prototype.html
```

على Windows أو Linux، افتح الملف بنقرة مزدوجة فقط.

أشياء تستحق التجربة:

1. **إعدادات غير موجودة:** بدّل البيئة إلى **dev** من الشريط العلوي. سيتحوّل `events-db` إلى اللون الرمادي لأنه لا يملك إعدادات لبيئة dev.
2. **وجهة الاستعلام:** افتح **Query editor** وانقر على الشارة `acme-db · dev · auto → read` لترى أين سيُنفَّذ استعلامك.
3. **المجلدات:** مرّر المؤشر فوق مجلد في **API Collections** ثم انقر **+** لإضافة طلب أو مجلد.
4. **الاستيراد:** اضغط **⇧⌘I** وجرّب استيراد مثال.
5. **انتقل إلى أي مكان:** اضغط **⌘K**.

### شغّل الاختبارات

تحتاج إلى Node.js 20 أو أحدث، ولا داعي لتثبيت أي شيء آخر.

```bash
npm test
```

## محتويات المستودع

| المسار | المحتوى |
|---|---|
| [`design/prototype.html`](design/prototype.html) | النموذج الأولي التفاعلي |
| [`design/tests/`](design/tests/) | اختبارات الوحدة لمنطق النموذج الأولي |
| [`apps/desktop/`](apps/desktop/) | تطبيق سطح المكتب: واجهة React وغلاف Tauri |
| [`crates/`](crates/) | Rust: الملفات الشخصية وتوجيه الاستعلامات وسلسلة المفاتيح ومشغّلا PostgreSQL وMongoDB |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | كيف بُني التطبيق ولماذا، بالإنجليزية |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | ما أُنجز وما سيأتي بعده، بالإنجليزية |
| [`docs/SECURITY.md`](docs/SECURITY.md) | نموذج التهديدات وكل إجراءات الأمان، بالإنجليزية |
| [`docs/RELEASING.md`](docs/RELEASING.md) | كيف تعمل الإصدارات والتحديث من داخل التطبيق، بما في ذلك مفتاح التوقيع وكلمة مروره، بالإنجليزية |

## الأمان

**وجدت ثغرة؟** من فضلك لا تفتح issue عامًا، بل أبلغ عنها بشكل خاص كما هو موضح في [SECURITY.md](SECURITY.md).

**تريد أن تعرف كيف يحمي Berth Studio أسرارك وشيفرته وإصداراته؟** اقرأ [docs/SECURITY.md](docs/SECURITY.md).

## المساهمة

يسعدنا انضمامك! اقرأ [CONTRIBUTING.md](CONTRIBUTING.md) أولًا. باختصار:

- **اتفاقية CLA:** وقّع [اتفاقية CLA](CLA.md) مرة واحدة فقط، وسيذكّرك البوت بذلك في أول pull request لك.
- **التوقيع:** أضف توقيعًا إلى كل commit باستخدام `git commit -s`.
- **الاختبارات:** شغّل `npm test` قبل أن تنفّذ push.

## الترخيص

يُنشر Berth Studio بموجب Apache License 2.0. التفاصيل في [LICENSE](LICENSE) و[NOTICE](NOTICE).

</div>

# شاشة واحدة 🎬

موقع يجمع مواعيد السينما في السعودية في مكان واحد. تبحث **بالوقت** ("وش يعرض الساعة 9؟") أو **بالفلم**، والحجز يصير من موقع الدار نفسها.

البيانات تتحدث تلقائياً كل ساعة عن طريق GitHub Actions، والموقع يشتغل مجاناً على GitHub Pages.

```
سحب (pipeline/scrapers)  →  تنظيف (clean.py)  →  توحيد الأفلام (match.py)  →  نشر (build.py)
                                                                                   ├─ site/data/showtimes.json  ← يقراه الموقع
                                                                                   └─ data/history/*.csv        ← أرشيف لكل عرض
```

## الدور المدعومة الحين

| الدار | الطريقة | ليش |
|---|---|---|
| ڤوكس | سحب تلقائي | robots.txt يسمح بصفحات `/showtimes/<فرع>` |
| ريل | رابط (فيه سحب تجريبي) | الموقع يعرض المواعيد بـ JavaScript، شوف `pipeline/scrapers/reel.py` |
| موفي | رابط | حماية ضد البوتات |
| إمباير، AMC | رابط | robots.txt يمنع البوتات |

كل الإعدادات في `config/sources.yaml`. **قبل ما تحوّل أي دار إلى سحب تلقائي اقرأ شروط استخدام موقعها بنفسك**، والأفضل تطلب منهم موافقة أو مصدر بيانات رسمي.

## التشغيل على GitHub (مرة وحدة)

1. أنشئ مستودع جديد على GitHub وارفع كل الملفات:
   ```bash
   git init && git add . && git commit -m "أول نسخة"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/shasha.git
   git push -u origin main
   ```
2. **Settings → Pages → Source:** اختر **GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions:** اختر **Read and write permissions**.
4. افتح `config/sources.yaml` وغيّر `user_agent` لاسم مستودعك وإيميلك. هذا يعرّف البوت حقك عند الدور.
5. **Actions → تحديث المواعيد ونشر الموقع → Run workflow** عشان أول تشغيل. بعدها يشتغل لحاله كل ساعة.

رابط موقعك بيكون: `https://YOUR_USERNAME.github.io/shasha/`

> ملاحظات: مواعيد GitHub المجدولة ممكن تتأخر كم دقيقة. ولو المستودع عام وما صار فيه نشاط لمدة 60 يوم، GitHub يوقف الجدولة. لو صار هذا، فعّلها من تبويب Actions.

## التشغيل على جهازك

```bash
pip install -r requirements.txt
python -m pipeline.run                                         # سحب حقيقي
python -m pipeline.run --fixture tests/fixtures/vox_showtimes.html   # تجربة بدون إنترنت
pytest -q tests
cd site && python -m http.server 8000                          # افتح http://localhost:8000
```

## النوتبوكات

| الملف | وش يسوي |
|---|---|
| `notebooks/01_scrape.ipynb` | يفحص robots.txt، يجيب قائمة الفروع، ويجرب السحب فرع فرع. افتحه أول ما ينكسر السحب |
| `notebooks/02_clean.ipynb` | يوريك التنظيف خطوة خطوة، ويفحص الجودة وتوحيد أسماء الأفلام |
| `notebooks/03_publish.ipynb` | يشغّل الخط كامل، ويحلل الأرشيف (حصة كل فلم من العروض يومياً) |

التشغيل التلقائي يستخدم **نفس الدوال** اللي في النوتبوكات، بس كسكربت (`python -m pipeline.run`) لأنه أثبت وأسرع في GitHub Actions. يعني أي تعديل تسويه في `pipeline/` يطبق على الاثنين.

## لو انكسر السحب

الموقع ما يفضى: لو فشلت دار، يعرض آخر بيانات ناجحة لها، ويتحول مؤشر "آخر تحديث" للون الأصفر.

1. افتح `notebooks/01_scrape.ipynb` وشغّل خلية "جرّب فرع واحد".
2. لو فيه روابط `/booking/` بس المحلّل رجّع صفر، عدّل `_movie_container` أو `EXPERIENCES` في `pipeline/scrapers/vox.py`.
3. أضف مثال من الصفحة الجديدة في `tests/fixtures/` واختبار له.

## إضافة دار جديدة

1. اكتب `pipeline/scrapers/<الدار>.py` فيها دالة `scrape(session, chain_cfg, cities)` ترجّع قائمة `RawShow`.
2. سجّلها في `SCRAPERS` داخل `pipeline/run.py`.
3. أضفها في `config/sources.yaml` بـ `mode: auto`.

## الإحصائيات والتنبيهات

- **عدد الزوار:** حط سكربت Google Analytics أو [Umami](https://umami.is) في `site/index.html` مكان التعليق. بدون أي تسجيل من الزائر.
- **تنبيهات الإيميل:** سوّ نموذج مجاني في [Formspree](https://formspree.io)، وحط رابطه في `formEndpoint` داخل `site/assets/app.js`. النموذج يظهر تلقائياً.
- عدّل `site/privacy.html` بإيميلك وراجعها مع متطلبات نظام حماية البيانات الشخصية قبل ما تجمع أي إيميل.

## هيكل المشروع

```
config/sources.yaml          إعدادات الدور والمدن
pipeline/
  http.py                    طلبات مؤدبة: robots.txt + انتظار + إعادة محاولة
  scrapers/vox.py            سحب ڤوكس
  scrapers/reel.py           سحب ريل (تجريبي، غير مفعّل)
  clean.py                   الأوقات، الأسماء، أنواع الشاشات، اللغات
  match.py                   ربط نفس الفلم بين الدور
  build.py                   ملف الموقع + الأرشيف
  run.py                     تشغيل الكل
notebooks/                   استكشاف وتشخيص وتحليل
site/                        الموقع (HTML/CSS/JS بدون مكتبات)
tests/                       اختبارات + صفحة اختبار صناعية
.github/workflows/update.yml التحديث كل ساعة والنشر
```

/** Landing page copy. Arabic first; English at /?lang=en. */
export type LandingLang = "ar" | "en";

export const landing = {
  ar: {
    meta: {
      title: "مجلس · حوّل خبرتك إلى مجتمع يدفع",
      description: "منصة عربية للمعلمين والمدربين: دورات فيديو، دردشة مباشرة مع طلابك، وبيع الاشتراكات، كل ذلك في مكان واحد.",
    },
    nav: { features: "المزايا", pricing: "الأسعار", faq: "الأسئلة", login: "تسجيل الدخول", start: "ابدأ مجاناً", lang: "English", menu: "القائمة", themeLight: "الوضع الفاتح", themeDark: "الوضع الداكن", language: "اللغة" },
    hero: {
      badge: "منصة عربية أولاً",
      title: "حوّل خبرتك إلى مجتمع يدفع",
      subtitle: "دوراتك، مجتمعك، ومبيعاتك في مكان واحد. أنشئ مجلسك، أضف دروس الفيديو، تحدّث مع طلابك، وبِع الاشتراكات، بدون خبرة تقنية.",
      primary: "ابدأ مجلسك مجاناً",
      secondary: "شاهد كيف يعمل",
      note: "مجاني للبدء · بدون بطاقة ائتمان · الطلاب لا يدفعون لمجلس أبداً",
    },
    who: {
      title: "لمن مجلس؟",
      items: [
        ["📚", "المعلمون", "دروس خصوصية ومجموعات مراجعة"],
        ["🎯", "المدربون", "دورات مهنية وورش عمل"],
        ["🕌", "معلمو القرآن", "حلقات تحفيظ ومتابعة"],
        ["🎨", "صنّاع المحتوى", "مجتمع لمتابعيك الأوفياء"],
      ],
    },
    how: {
      title: "ثلاث خطوات فقط",
      steps: [
        ["أنشئ مجلسك", "اختر اسماً وادعُ طلابك برابط واحد عبر واتساب أو انستقرام."],
        ["أضف الدورات والنقاش", "ارفع فيديوهاتك أو روابط يوتيوب، ونظّمها في أقسام، وافتح قنوات للأسئلة والإعلانات."],
        ["بِع واستلم أرباحك", "حدد السعر وما يفتحه، والطلاب يدفعون مباشرة إلى حسابك في Whop."],
      ],
    },
    features: {
      title: "كل ما تحتاجه لتعلّم وتبيع",
      items: [
        ["🔤", "عربي أولاً", "واجهة من اليمين لليسار، بحث يفهم الحروف العربية، وأرقام عربية هندية إن شئت."],
        ["🎓", "دورات فيديو", "أقسام ودروس وملاحظات وملفات، مع تتبّع تقدّم الطالب واستئناف الفيديو من حيث توقّف."],
        ["💬", "دردشة مباشرة", "قنوات للنقاش وردود وتفاعلات وإرفاق ملفات، كل شيء لحظي."],
        ["📢", "قنوات إعلانات", "أنت وفريقك تنشرون، وطلابك يقرؤون ويتفاعلون."],
        ["🔒", "محتوى مجاني ومدفوع", "اجعل أي دورة أو قناة مدفوعة، مع دروس معاينة مجانية تُقنع الزائر بالاشتراك."],
        ["💳", "بيع الاشتراكات", "دفعة واحدة أو شهري أو سنوي، مع تجربة مجانية وحد للمقاعد."],
        ["🧭", "لوحة المعلم", "قائمة خطوات واضحة من أول دورة حتى أول عملية بيع."],
        ["📱", "تطبيق للجوال", "تطبيق آيفون وأندرويد لطلابك (قريباً)."],
      ],
    },
    shots: {
      title: "شاهد مجلس من الداخل",
      items: [
        ["لوحة المعلم: خطوة بخطوة حتى أول عملية بيع", "/landing/dashboard.png"],
        ["محرر الدورات: أقسام ودروس وفيديو", "/landing/editor.png"],
        ["الطالب على الجوال: كل شيء في الرئيسية", "/landing/home-mobile.png"],
      ],
    },
    pricing: {
      title: "أسعار بسيطة للمعلمين",
      subtitle: "الطلاب ينضمّون ويتعلّمون مجاناً دائماً. أنت تدفع اشتراك المنصة فقط، ولا نأخذ أي نسبة من مبيعاتك.",
      monthly: "/ شهرياً",
      free: "مجاني",
      popular: "الأكثر اختياراً",
      trial: "تجربة مجانية ١٤ يوماً",
      cta: "ابدأ الآن",
      tiers: {
        free: "مجاني",
        starter: "المبتدئ",
        pro: "المحترف",
        academy: "الأكاديمية",
      },
      servers: (n: number) => (n === 1 ? "مجلس واحد" : `${n} مجالس`),
      offers: (n: number | null) => (n === null ? "عروض غير محدودة" : n === 0 ? "مجتمع مجاني فقط" : `${n} عروض لكل مجلس`),
      storage: (gb: number) => (gb >= 1024 ? `${gb / 1024} تيرابايت تخزين` : `${gb} جيجابايت تخزين`),
      noCommission: "بدون عمولة على المبيعات",
      yearly: "أو وفّر شهرين بالدفع السنوي",
    },
    faq: {
      title: "أسئلة شائعة",
      items: [
        ["هل يأخذ مجلس نسبة من مبيعاتي؟", "لا. أنت تدفع اشتراك المنصة فقط. الطلاب يدفعون مباشرة إلى حسابك في Whop، وتُطبّق فقط رسوم الدفع الخاصة بـ Whop."],
        ["كيف أستلم أرباحي؟", "الأموال تصل إلى حسابك في Whop مباشرة، ومن هناك تسحبها إلى حسابك البنكي. مجلس لا يحتفظ بأموالك."],
        ["هل يدفع الطلاب لاستخدام مجلس؟", "لا. الانضمام والتعلّم في المحتوى المجاني مجاني دائماً. الطالب يدفع فقط لما يبيعه المعلم."],
        ["ماذا لو طلب طالب استرداد المبلغ؟", "أنت البائع، فتتحكم بالاسترداد من حسابك في Whop، ويُسحب الوصول تلقائياً عند الاسترداد."],
        ["هل المحتوى محمي؟", "روابط الفيديو والملفات مؤقتة وموقّعة، ولا تُعطى إلا لمن يملك صلاحية الوصول."],
        ["هل أحتاج خبرة تقنية؟", "لا. لوحة المعلم ترشدك خطوة بخطوة: أول دورة، أول درس، دعوة الطلاب، ثم البيع."],
        ["أين تُحفظ البيانات؟", "على خوادم في فرانكفورت (الاتحاد الأوروبي)، مع ملفات الفيديو في Cloudflare R2."],
      ],
    },
    final: { title: "مجلسك ينتظرك", subtitle: "أنشئ مجتمعك في دقيقة، وابدأ بالتدريس اليوم.", cta: "ابدأ مجلسك مجاناً" },
    footer: { tagline: "منصة عربية للتعليم والمجتمعات", login: "تسجيل الدخول", register: "إنشاء حساب", rights: "جميع الحقوق محفوظة" },
  },
  en: {
    meta: {
      title: "Majlis · Turn your expertise into a paying community",
      description: "An Arabic-first platform for teachers and coaches: video courses, live chat with your students, and paid memberships in one place.",
    },
    nav: { features: "Features", pricing: "Pricing", faq: "FAQ", login: "Log in", start: "Start free", lang: "العربية", menu: "Menu", themeLight: "Light mode", themeDark: "Dark mode", language: "Language" },
    hero: {
      badge: "Arabic-first platform",
      title: "Turn your expertise into a paying community",
      subtitle: "Your courses, your community and your sales in one place. Create your majlis, add video lessons, talk with your students and sell memberships, no tech skills needed.",
      primary: "Start your majlis free",
      secondary: "See how it works",
      note: "Free to start · No credit card · Students never pay Majlis",
    },
    who: {
      title: "Who is Majlis for?",
      items: [
        ["📚", "Teachers", "Tutoring and revision groups"],
        ["🎯", "Coaches & trainers", "Professional courses and workshops"],
        ["🕌", "Quran teachers", "Memorisation circles and follow-up"],
        ["🎨", "Creators", "A home for your most loyal fans"],
      ],
    },
    how: {
      title: "Three steps",
      steps: [
        ["Create your majlis", "Pick a name and invite your students with one link on WhatsApp or Instagram."],
        ["Add courses and chat", "Upload videos or YouTube links, organise them in sections, and open channels for questions and announcements."],
        ["Sell and get paid", "Set a price and what it unlocks. Students pay your own Whop account directly."],
      ],
    },
    features: {
      title: "Everything you need to teach and sell",
      items: [
        ["🔤", "Arabic first", "Right-to-left interface, search that understands Arabic letters, and Arabic-Indic digits if you like."],
        ["🎓", "Video courses", "Sections, lessons, notes and files, with student progress and videos that resume where they stopped."],
        ["💬", "Live chat", "Channels, replies, reactions and attachments, all in real time."],
        ["📢", "Announcement channels", "You and your team post; students read and react."],
        ["🔒", "Free and paid content", "Make any course or channel paid, with free preview lessons that turn visitors into subscribers."],
        ["💳", "Memberships", "One-time, monthly or yearly, with free trials and seat limits."],
        ["🧭", "Teacher dashboard", "A clear checklist from your first course to your first sale."],
        ["📱", "Mobile apps", "iPhone and Android apps for your students (coming soon)."],
      ],
    },
    shots: {
      title: "A look inside",
      items: [
        ["Teacher dashboard: step by step to your first sale", "/landing/dashboard.png"],
        ["Course editor: sections, lessons, video", "/landing/editor.png"],
        ["Students on mobile: everything on one home", "/landing/home-mobile.png"],
      ],
    },
    pricing: {
      title: "Simple pricing for teachers",
      subtitle: "Students always join and learn for free. You pay for the platform only; we take no cut of your sales.",
      monthly: "/ month",
      free: "Free",
      popular: "Most popular",
      trial: "14-day free trial",
      cta: "Get started",
      tiers: { free: "Free", starter: "Starter", pro: "Pro", academy: "Academy" },
      servers: (n: number) => (n === 1 ? "1 majlis" : `${n} majlises`),
      offers: (n: number | null) => (n === null ? "Unlimited offers" : n === 0 ? "Free community only" : `${n} offers per majlis`),
      storage: (gb: number) => (gb >= 1024 ? `${gb / 1024} TB storage` : `${gb} GB storage`),
      noCommission: "No commission on sales",
      yearly: "Or save two months with yearly billing",
    },
    faq: {
      title: "Questions",
      items: [
        ["Does Majlis take a cut of my sales?", "No. You pay the platform subscription only. Students pay your own Whop account directly; only Whop's payment fees apply."],
        ["How do I get paid?", "Money goes straight to your Whop account, and you withdraw it to your bank from there. Majlis never holds your money."],
        ["Do students pay to use Majlis?", "No. Joining and free content are always free. Students only pay for what a teacher sells."],
        ["What if a student asks for a refund?", "You're the seller, so you handle refunds in your Whop account; access is removed automatically when you refund."],
        ["Is my content protected?", "Video and file links are short-lived and signed, and only issued to people who have access."],
        ["Do I need technical skills?", "No. The teacher dashboard walks you through it: first course, first lesson, inviting students, then selling."],
        ["Where is data stored?", "On servers in Frankfurt (EU), with video files on Cloudflare R2."],
      ],
    },
    final: { title: "Your majlis is waiting", subtitle: "Create your community in a minute and start teaching today.", cta: "Start your majlis free" },
    footer: { tagline: "Arabic-first platform for learning communities", login: "Log in", register: "Create account", rights: "All rights reserved" },
  },
} as const;

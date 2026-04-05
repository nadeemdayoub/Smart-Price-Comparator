import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  ArrowRight, 
  CheckCircle2, 
  Globe, 
  BarChart3, 
  Layers, 
  RefreshCw, 
  History, 
  PlusCircle, 
  PieChart,
  Users,
  Building2,
  Settings,
  Briefcase
} from 'lucide-react';

type Language = 'en' | 'ar';

const LandingPage: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const navigate = useNavigate();

  const isAr = lang === 'ar';

  const content = {
    en: {
      hero: {
        title: "Turn supplier quotations into faster, smarter purchasing decisions",
        subtitle: "An intelligent platform that helps you upload quotations, match products, compare suppliers, and identify the best prices with clarity and speed.",
        getStarted: "Get Started",
        exploreFeatures: "Explore Features"
      },
      howItWorks: {
        title: "How It Works",
        steps: [
          { title: "Upload the quotation", desc: "Simply drag and drop your supplier's Excel or PDF file." },
          { title: "Review smart matching", desc: "Our AI automatically matches items to your catalog." },
          { title: "Compare prices and decide", desc: "Instantly see who offers the best value across all items." }
        ]
      },
      features: {
        title: "Core Features",
        list: [
          "Smart product matching",
          "Direct supplier comparison",
          "Automatic currency conversion",
          "Historical quotation tracking",
          "Create new products during review",
          "Clear reports and analytics"
        ]
      },
      whoIsItFor: {
        title: "Who Is It For?",
        list: [
          { title: "Procurement teams", icon: <Users className="w-6 h-6" /> },
          { title: "Trading companies", icon: <Building2 className="w-6 h-6" /> },
          { title: "Operations managers", icon: <Settings className="w-6 h-6" /> },
          { title: "Business owners", icon: <Briefcase className="w-6 h-6" /> }
        ]
      },
      cta: {
        title: "Start managing supplier quotations in a smarter way",
        button: "Create Account"
      }
    },
    ar: {
      hero: {
        title: ["حـــــول عـــــروض", "اسـعار الــموردين", "الى قرارات شـراء", "اوضـــح واســـرع"],
        subtitle: "منصة ذكية تساعدك على رفع  عروض الأسعار، مطابقة المنتجات، مقارنة الموردين، وتحليل أفضل سعر بطريقة منظمة وسهلة.",
        getStarted: "ابدأ الآن",
        exploreFeatures: "تعرّف على الميزات"
      },
      howItWorks: {
        title: "كيف يعمل؟",
        steps: [
          { title: "ارفع الكوتيشن", desc: "ببساطة قم بسحب وإفلات ملف المورد الخاص بك." },
          { title: "راجع المطابقة الذكية", desc: "يقوم نظامنا بمطابقة العناصر تلقائيًا مع الكتالوج الخاص بك." },
          { title: "قارن الأسعار واتخذ القرار", desc: "شاهد فوراً من يقدم أفضل قيمة لجميع العناصر." }
        ]
      },
      features: {
        title: "الميزات الأساسية",
        list: [
          "مطابقة ذكية للمنتجات",
          "مقارنة مباشرة بين الموردين",
          "تحويل تلقائي للعملات",
          "تتبع العروض السابقة",
          "إنشاء منتجات جديدة أثناء المراجعة",
          "تقارير وتحليلات أوضح"
        ]
      },
      whoIsItFor: {
        title: "لمن هذه المنصة؟",
        list: [
          { title: "فرق المشتريات", icon: <Users className="w-6 h-6" /> },
          { title: "الشركات التجارية", icon: <Building2 className="w-6 h-6" /> },
          { title: "مدراء العمليات", icon: <Settings className="w-6 h-6" /> },
          { title: "أصحاب الأعمال", icon: <Briefcase className="w-6 h-6" /> }
        ]
      },
      cta: {
        title: "ابدأ بتنظيم عروض الموردين بطريقة أذكى",
        button: "إنشاء حساب"
      }
    }
  };

  const t = content[lang];

  return (
    <div className={`min-h-screen bg-white text-stone-900 font-sans ${isAr ? 'font-arabic' : ''}`} dir={isAr ? 'rtl' : 'ltr'}>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-black tracking-tight">SmartPrice</span>
          </div>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="flex items-center gap-2 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors"
            >
              <Globe className="w-4 h-4" />
              {lang === 'en' ? 'العربية' : 'English'}
            </button>
            <button 
              onClick={() => navigate('/login')}
              className="px-6 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20"
            >
              {t.hero.getStarted}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: isAr ? 50 : -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-5xl lg:text-7xl font-black leading-[1.05] tracking-tight mb-8">
              {Array.isArray(t.hero.title) ? (
                <div className="flex flex-col w-full max-w-2xl">
                  {t.hero.title.map((line, i) => (
                    <div 
                      key={i} 
                      className="w-full text-justify" 
                      style={{ textAlignLast: 'justify', display: 'block' }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ) : (
                t.hero.title
              )}
            </h1>
            <p className="text-xl text-stone-600 leading-relaxed mb-10 max-w-xl">
              {t.hero.subtitle}
            </p>
            <div className="flex flex-wrap gap-4">
              <button 
                onClick={() => navigate('/login')}
                className="px-8 py-4 bg-amber-500 text-white rounded-2xl text-lg font-bold hover:bg-amber-600 transition-all shadow-xl shadow-amber-500/30 flex items-center gap-3 group"
              >
                {t.hero.getStarted}
                <ArrowRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${isAr ? 'rotate-180 group-hover:-translate-x-1' : ''}`} />
              </button>
              <button className="px-8 py-4 bg-white text-stone-700 border-2 border-stone-200 rounded-2xl text-lg font-bold hover:bg-stone-50 hover:border-stone-300 transition-all">
                {t.hero.exploreFeatures}
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative flex justify-center lg:justify-end"
          >
            <div className="w-full max-w-[600px] aspect-square bg-white rounded-[3rem] overflow-hidden shadow-2xl border border-stone-100 group transition-all duration-500 hover:-translate-y-3 hover:shadow-[0_35px_60px_-15px_rgba(0,0,0,0.2)]">
              <img 
                src="https://i.imgur.com/H0GinrS.jpeg" 
                alt="Smart Price Comparator Dashboard" 
                className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-stone-900/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-32 bg-stone-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-black mb-4">{t.howItWorks.title}</h2>
            <div className="w-20 h-1.5 bg-amber-500 mx-auto rounded-full" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {t.howItWorks.steps.map((step, idx) => (
              <motion.div 
                key={idx}
                whileHover={{ y: -10 }}
                className="p-10 bg-white rounded-[2rem] shadow-sm border border-stone-100 relative group overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                  <span className="text-9xl font-black">{idx + 1}</span>
                </div>
                <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-amber-500/20">
                  {idx === 0 && <Layers className="w-8 h-8 text-white" />}
                  {idx === 1 && <RefreshCw className="w-8 h-8 text-white" />}
                  {idx === 2 && <BarChart3 className="w-8 h-8 text-white" />}
                </div>
                <h3 className="text-2xl font-black mb-4">{step.title}</h3>
                <p className="text-stone-500 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <div>
              <h2 className="text-4xl font-black mb-12">{t.features.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {t.features.list.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-stone-50 transition-colors group">
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <span className="font-bold text-stone-700">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6 pt-12">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="p-8 bg-amber-500 rounded-[2rem] text-white shadow-xl hover:-translate-y-2 transition-transform duration-300"
                >
                  <History className="w-10 h-10 mb-6 opacity-50" />
                  <h4 className="text-xl font-bold mb-2">{isAr ? 'تاريخ العروض' : 'History'}</h4>
                  <p className="text-sm text-amber-100">{isAr ? 'تتبع تقلبات الأسعار عبر الزمن' : 'Track price fluctuations over time'}</p>
                </motion.div>
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
                  className="p-8 bg-emerald-500 rounded-[2rem] text-white shadow-xl hover:-translate-y-2 transition-transform duration-300"
                >
                  <PlusCircle className="w-10 h-10 mb-6 opacity-50" />
                  <h4 className="text-xl font-bold mb-2">{isAr ? 'إضافة سريعة' : 'Quick Add'}</h4>
                  <p className="text-sm text-emerald-100">{isAr ? 'أضف منتجات جديدة فوراً' : 'Add new products instantly'}</p>
                </motion.div>
              </div>
              <div className="space-y-6">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
                  className="p-8 bg-stone-100 rounded-[2rem] shadow-xl hover:-translate-y-2 transition-transform duration-300"
                >
                  <PieChart className="w-10 h-10 mb-6 text-stone-400" />
                  <h4 className="text-xl font-bold mb-2 text-stone-900">{isAr ? 'تحليلات' : 'Analytics'}</h4>
                  <p className="text-sm text-stone-500">{isAr ? 'تقارير مفصلة لاتخاذ القرار' : 'Detailed reports for decision making'}</p>
                </motion.div>
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.45 }}
                  className="p-8 bg-white border border-stone-200 rounded-[2rem] shadow-xl hover:-translate-y-2 transition-transform duration-300"
                >
                  <Globe className="w-10 h-10 mb-6 text-stone-400" />
                  <h4 className="text-xl font-bold mb-2 text-stone-900">{isAr ? 'عملات متعددة' : 'Multi-currency'}</h4>
                  <p className="text-sm text-stone-500">{isAr ? 'تحويل تلقائي لسهولة المقارنة' : 'Auto-conversion for easy comparison'}</p>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who Is It For */}
      <section className="py-32 bg-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-black mb-4">{t.whoIsItFor.title}</h2>
            <div className="w-20 h-1.5 bg-white/20 mx-auto rounded-full" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {t.whoIsItFor.list.map((item, idx) => (
              <div key={idx} className="text-center p-8 rounded-[2rem] bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
                <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold">{item.title}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-40">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-5xl font-black mb-10 leading-tight">
              {t.cta.title}
            </h2>
            <button 
              onClick={() => navigate('/login')}
              className="px-12 py-5 bg-amber-500 text-white rounded-2xl text-xl font-bold hover:bg-amber-600 transition-all shadow-2xl shadow-amber-500/40"
            >
              {t.cta.button}
            </button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-stone-100">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-stone-900 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-black tracking-tight">SmartPrice</span>
          </div>
          <p className="text-stone-400 text-sm font-medium">
            © 2026 Smart Price Comparator. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm font-bold text-stone-500 hover:text-stone-900 transition-colors">Privacy</a>
            <a href="#" className="text-sm font-bold text-stone-500 hover:text-stone-900 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

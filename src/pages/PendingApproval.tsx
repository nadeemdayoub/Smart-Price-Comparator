import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Clock, 
  ShieldCheck, 
  Phone, 
  LogOut, 
  Globe,
  Mail,
  CheckCircle2
} from 'lucide-react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

type Language = 'en' | 'ar';

const PendingApproval: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const navigate = useNavigate();
  const isAr = lang === 'ar';

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };

  const content = {
    en: {
      title: "Your account is under review",
      subtitle: "Thank you for registering. Your account will be activated as soon as possible.",
      contact: "For assistance, contact us anytime:",
      logout: "Sign Out",
      status: "Account Status: Pending Approval",
      phone: "009647714087472"
    },
    ar: {
      title: "حسابك قيد المراجعة",
      subtitle: "شكرًا لتسجيلك في المنصة. سيتم تفعيل حسابك في أقرب وقت ممكن.",
      contact: "للتواصل معنا في أي وقت:",
      logout: "تسجيل الخروج",
      status: "حالة الحساب: قيد المراجعة",
      phone: "009647714087472"
    }
  };

  const t = content[lang];

  return (
    <div className={`min-h-screen bg-stone-50 flex items-center justify-center p-6 ${isAr ? 'font-arabic' : ''}`} dir={isAr ? 'rtl' : 'ltr'}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl w-full bg-white rounded-[2.5rem] shadow-2xl border border-stone-200 p-10 lg:p-16 text-center relative overflow-hidden"
      >
        {/* Background Accents */}
        <div className="absolute top-0 left-0 w-full h-2 bg-amber-500" />
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-50 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-stone-50 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-amber-50 rounded-[2rem] mb-10 animate-pulse">
            <Clock className="w-12 h-12 text-amber-600" />
          </div>

          <h1 className="text-3xl lg:text-4xl font-black text-stone-900 mb-6 leading-tight">
            {t.title}
          </h1>
          
          <p className="text-lg text-stone-500 leading-relaxed mb-12">
            {t.subtitle}
          </p>

          <div className="bg-stone-50 rounded-3xl p-8 mb-12 border border-stone-100">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-sm font-black text-amber-700 uppercase tracking-widest">
                {t.status}
              </span>
            </div>

            <p className="text-stone-600 font-bold mb-4">{t.contact}</p>
            <a 
              href={`tel:${t.phone}`}
              className="inline-flex items-center gap-3 text-2xl font-black text-stone-900 hover:text-amber-600 transition-colors"
            >
              <Phone className="w-6 h-6" />
              {t.phone}
            </a>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button 
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="flex items-center gap-2 px-6 py-3 text-stone-600 font-bold hover:text-stone-900 transition-colors"
            >
              <Globe className="w-5 h-5" />
              {lang === 'en' ? 'العربية' : 'English'}
            </button>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-8 py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-900/20 group"
            >
              <LogOut className={`w-5 h-5 transition-transform group-hover:-translate-x-1 ${isAr ? 'rotate-180 group-hover:translate-x-1' : ''}`} />
              {t.logout}
            </button>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-stone-100 flex items-center justify-center gap-6">
          <div className="flex items-center gap-2 text-stone-400">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Secure Platform</span>
          </div>
          <div className="flex items-center gap-2 text-stone-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Verified Identity</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PendingApproval;

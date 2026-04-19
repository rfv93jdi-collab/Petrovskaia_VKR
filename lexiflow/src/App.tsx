import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  LayoutDashboard, 
  FileSearch, 
  Target, 
  ClipboardList, 
  ChevronRight, 
  Plus, 
  Flame, 
  Zap,
  Trophy,
  ArrowRight,
  Upload,
  User,
  Calendar as CalendarIcon,
  X,
  Settings,
  Building2,
  Users,
  Gavel,
  Receipt,
  MessageSquare,
  Send,
  Loader2
} from 'lucide-react';
import { cn } from './lib/utils';
import { Risk, Task, AppState, ChatMessage, Regulation, ActivityLog } from './types';
import { INITIAL_QUESTIONS, CORPORATE_QUESTIONS, INITIAL_TASKS, DOCUMENT_CATEGORIES } from './constants';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { askLexi } from './services/lexiService';
import { analyzeDocument } from './services/aiService';
import { 
  Folder, 
  FileText, 
  ArrowLeft, 
  Search,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

// --- Components ---

const ProgressBar = ({ value, color = 'bg-cyan-500' }: { value: number, color?: string }) => (
  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
    <motion.div 
      initial={{ width: 0 }}
      animate={{ width: `${value}%` }}
      className={cn("h-full", color)}
    />
  </div>
);

const Badge = ({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'neon' | 'danger' | 'warning' }) => {
  const styles = {
    default: "bg-white/10 text-white/70",
    neon: "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
    danger: "bg-rose-500/20 text-rose-400 border border-rose-500/30",
    warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", styles[variant])}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [state, setState] = useState<AppState>({
    healthScore: 65,
    risks: [],
    tasks: INITIAL_TASKS,
    regulations: [],
    activityLogs: [
      { id: 'log-1', action: 'Завершен квест по ПДн', timestamp: '2026-03-22 10:30', user: 'Алексей Иванов', type: 'quest' },
      { id: 'log-2', action: 'Добавлена задача: Доверенность', timestamp: '2026-03-22 11:15', user: 'Алексей Иванов', type: 'task' }
    ],
    categoryScores: {
      hr: 0,
      infosec: 0,
      court: 0,
      tax: 0
    },
    segment: 'small',
    questStep: 0,
    selectedQuestCategory: null,
    isQuestCompleted: false,
    activeFolderId: null,
    lastUploadedDocName: null,
    user: {
      name: 'Алексей Иванов',
      company: 'ООО "ТехноСтарт"',
      role: 'Генеральный директор',
      level: 4,
      xp: 2450,
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix'
    }
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'quest' | 'audit' | 'matrix' | 'profile'>('dashboard');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [extractedClauses, setExtractedClauses] = useState<string[]>([]);
  const [showSegmentSelector, setShowSegmentSelector] = useState(true);
  
  // Risk Action Plan Modal
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null);
  const [isActionPlanOpen, setIsActionPlanOpen] = useState(false);

  // Lexi Chat
  const [isLexiOpen, setIsLexiOpen] = useState(false);
  const [chatRisk, setChatRisk] = useState<Risk | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLexiLoading, setIsLexiLoading] = useState(false);
  const [newRegTitle, setNewRegTitle] = useState('');
  const [newRegContent, setNewRegContent] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [selectedRegForCompare, setSelectedRegForCompare] = useState<Regulation | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [isComparingAll, setIsComparingAll] = useState(false);
  const [isCompareResultOpen, setIsCompareResultOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const questions = state.segment === 'small' 
    ? (state.selectedQuestCategory 
        ? INITIAL_QUESTIONS.filter(q => q.category === state.selectedQuestCategory)
        : INITIAL_QUESTIONS)
    : CORPORATE_QUESTIONS;
  const currentQuestion = questions[state.questStep];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleQuestAnswer = (impact: number, risk?: Partial<Risk>) => {
    setState(prev => {
      const q = questions[prev.questStep];
      const qId = q.id;
      const category = q.category;
      const newCategoryScores = { ...prev.categoryScores };
      
      if (impact < 0) {
        const weight = Math.abs(impact);
        newCategoryScores[category] = (newCategoryScores[category] || 0) + weight;
      }

      const newRisks = risk ? [...prev.risks, { 
        id: `r-${Date.now()}`, 
        status: 'open', 
        category: category === 'hr' ? 'HR' : category === 'tax' ? 'Налоги' : category === 'infosec' ? 'Инфобез' : 'Судебный',
        recommendation: q.actionPlan || 'Исправить немедленно',
        ...risk 
      } as Risk] : prev.risks;
      
      const nextStep = prev.questStep + 1;
      const isCompleted = nextStep >= questions.length;

      // If completed, we don't immediately set isQuestCompleted to true
      // Instead, we might want to show a final upload step
      
      return {
        ...prev,
        healthScore: Math.min(100, Math.max(0, prev.healthScore + impact)),
        categoryScores: newCategoryScores,
        risks: newRisks,
        questStep: nextStep,
        isQuestCompleted: isCompleted,
        selectedQuestCategory: isCompleted ? prev.selectedQuestCategory : prev.selectedQuestCategory,
      };
    });
  };

  const completeQuest = () => {
    setState(prev => ({
      ...prev,
      isQuestCompleted: true,
      selectedQuestCategory: null,
      questStep: 0
    }));
    setActiveTab('matrix');
    logActivity(`Завершен квест по категории: ${state.selectedQuestCategory}`, 'quest');
  };

  const logActivity = (action: string, type: ActivityLog['type']) => {
    const newLog: ActivityLog = {
      id: `log-${Date.now()}`,
      action,
      timestamp: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
      user: state.user.name,
      type
    };
    setState(prev => ({ ...prev, activityLogs: [newLog, ...prev.activityLogs] }));
  };

  const toggleTask = (taskId: string) => {
    setState(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t),
      healthScore: prev.tasks.find(t => t.id === taskId)?.status === 'todo' ? Math.min(100, prev.healthScore + 5) : Math.max(0, prev.healthScore - 5)
    }));
  };

  const addTask = () => {
    if (!newTaskTitle.trim()) return;
    const newTask: Task = {
      id: `t-${Date.now()}`,
      title: newTaskTitle,
      description: 'Добавлено вручную',
      status: 'todo',
      points: 50,
      deadline: newTaskDeadline || undefined
    };
    setState(prev => ({ ...prev, tasks: [newTask, ...prev.tasks] }));
    logActivity(`Создана задача: ${newTaskTitle}`, 'task');
    setNewTaskTitle('');
    setNewTaskDeadline('');
    setIsTaskModalOpen(false);
  };

  const handleAddActionToTasks = (action: string) => {
    // Prompt for deadline
    const deadline = prompt(`Установите срок для задачи: "${action}" (например, 25.03.2026)`, '');
    
    const newTask: Task = {
      id: `t-action-${Date.now()}`,
      title: action,
      description: `Из плана действий по риску: ${selectedRisk?.title}`,
      status: 'todo',
      points: 100,
      deadline: deadline || undefined
    };
    
    setState(prev => ({ ...prev, tasks: [newTask, ...prev.tasks] }));
    logActivity(`Добавлена задача из плана: ${action}`, 'task');
    alert('Задача добавлена в список!');
  };

  const addRegulation = () => {
    if (!newRegTitle.trim()) return;
    const newReg: Regulation = {
      id: `reg-${Date.now()}`,
      title: newRegTitle,
      content: newRegContent,
      category: 'Legal',
      lastUpdated: new Date().toISOString().split('T')[0]
    };
    setState(prev => ({ ...prev, regulations: [newReg, ...prev.regulations] }));
    logActivity(`Добавлен регламент: ${newRegTitle}`, 'regulation');
    setNewRegTitle('');
    setNewRegContent('');
    setIsRegModalOpen(false);
  };

  const simulateAnalysis = async (file?: File, categoryId?: string) => {
    if (isAnalyzing || isExtracting) return;
    
    if (!file) {
      alert('Пожалуйста, выберите файл для анализа.');
      return;
    }

    const fileName = file.name;
    const previousDoc = state.lastUploadedDocName;
    
    try {
      // Phase 1: Extraction (OCR)
      setIsExtracting(true);
      setExtractedClauses([]);
      
      // Artificial delay for OCR visibility
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Phase 2: AI Analysis
      setIsExtracting(false);
      setIsAnalyzing(true);
      
      const result = await analyzeDocument(file);
      const normalizedClauses = Array.isArray(result.clauses)
        ? result.clauses.filter(clause => typeof clause === 'string' && clause.trim().length > 0)
        : [];
      const safeClauses = normalizedClauses.length > 0
        ? normalizedClauses
        : ['Документ обработан. Ключевые сущности не были выделены автоматически, но риск сформирован.'];
      
      setExtractedClauses(safeClauses);
      
      const newRisk: Risk = {
        id: `r-audit-${Date.now()}`,
        title: result.risk.title || `Несоответствие в ${fileName}`,
        description: result.risk.description || 'В документе выявлено противоречие внутренним регламентам компании.',
        severity: (result.risk.severity as any) || 'Критично',
        impact: 95,
        probability: 100,
        category: 'Комплаенс',
        status: 'open',
        recommendation: result.risk.recommendation || 'Пересмотреть условия договора.',
        actionPlan: result.risk.actionPlan || [
          'Подготовить дополнительное соглашение',
          'Согласовать с юридическим отделом',
          'Обновить статус в системе'
        ]
      };

      const newDoc: Regulation = {
        id: `doc-${Date.now()}`,
        title: fileName,
        content: safeClauses.join('\n'),
        category: categoryId || 'Uncategorized',
        lastUpdated: new Date().toISOString().split('T')[0],
        risks: [newRisk]
      };

      setState(prev => ({
        ...prev,
        risks: [...prev.risks, newRisk],
        regulations: [...prev.regulations, newDoc],
        healthScore: Math.max(0, prev.healthScore - 10),
        lastUploadedDocName: fileName
      }));
      
      setIsAnalyzing(false);
      logActivity(`Проведен аудит документа: ${fileName}`, 'quest');

      if (previousDoc) {
        const shouldCompare = window.confirm(
          `Документ загружен.\nСравнить с ранее загруженным регламентом: ${previousDoc}?\n\nНажмите "ОК" для сравнения или "Отмена" чтобы не сравнивать.`
        );
        if (shouldCompare) {
          handleCompareAll();
        }
      }
    } catch (error) {
      console.error("Analysis error:", error);
      setIsExtracting(false);
      setIsAnalyzing(false);
      alert('Произошла ошибка при анализе документа. Пожалуйста, попробуйте еще раз.');
    }
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>, categoryId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      simulateAnalysis(file, categoryId);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      simulateAnalysis(file);
    }
  };

  const handleCompareAll = () => {
    setIsComparingAll(true);
    // Simulate deep cross-document analysis
    setTimeout(() => {
      setIsComparingAll(false);
      setIsCompareResultOpen(true);
    }, 2500);
  };

  const handleLexiChat = async () => {
    if (!input.trim() || !chatRisk) return;
    const userMsg: ChatMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLexiLoading(true);
    
    const response = await askLexi(chatRisk.title, chatRisk.description, input);
    setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    setIsLexiLoading(false);
  };

  const openLexi = (risk: Risk) => {
    setChatRisk(risk);
    setMessages([{ role: 'assistant', content: `Привет! Я Лекси. Давайте обсудим риск "${risk.title}". Чем я могу помочь?` }]);
    setIsLexiOpen(true);
  };

  if (showSegmentSelector) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8"
        >
          <div className="col-span-full text-center mb-8">
            <h1 className="text-4xl font-black mb-4">Выберите тип бизнеса</h1>
            <p className="text-white/40">Мы адаптируем интерфейс и проверки под ваши задачи</p>
          </div>

          <button 
            onClick={() => { setState(s => ({ ...s, segment: 'small' })); setShowSegmentSelector(false); }}
            className="group bg-white/[0.02] border border-white/5 p-12 rounded-[40px] hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all text-left"
          >
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
              <Building2 className="w-8 h-8 text-cyan-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Малый бизнес</h3>
            <p className="text-white/40 text-sm leading-relaxed">Фокус на базовой безопасности, исправлении ошибок и пошаговых инструкциях для ИП и ООО.</p>
          </button>

          <button 
            onClick={() => { setState(s => ({ ...s, segment: 'large' })); setShowSegmentSelector(false); setActiveTab('audit'); }}
            className="group bg-white/[0.02] border border-white/5 p-12 rounded-[40px] hover:border-violet-500/50 hover:bg-violet-500/5 transition-all text-left"
          >
            <div className="w-16 h-16 rounded-2xl bg-violet-500/20 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
              <Users className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Корпорация</h3>
            <p className="text-white/40 text-sm leading-relaxed">Глубокий аудит регламентов, фильтр коллизий и сложная матрица рисков для крупных структур.</p>
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-cyan-500/30">
      {/* Sidebar */}
      <nav className="fixed left-0 top-0 h-full w-20 border-r border-white/5 bg-black/40 flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Shield className="w-6 h-6 text-white" />
        </div>
        
        <div className="flex flex-col gap-4">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Главная' },
            { id: 'quest', icon: Target, label: state.segment === 'small' ? 'Квест' : 'Регламенты' },
            { id: 'audit', icon: FileSearch, label: state.segment === 'small' ? 'Проверка документов' : 'Сравнение' },
            { id: 'matrix', icon: AlertTriangle, label: 'Матрица' },
            { id: 'profile', icon: User, label: 'Профиль' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "p-3 rounded-xl transition-all group relative",
                activeTab === item.id ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40" : "text-white/40 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className="w-6 h-6" />
              <span className="absolute left-full ml-4 px-2 py-1 bg-white text-black text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {item.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-4">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 rounded-xl text-white/20 hover:text-white transition-colors"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pl-20 min-h-screen">
        <header className="h-24 border-b border-white/5 flex items-center justify-between px-12 sticky top-0 bg-[#0A0A0A]/80 backdrop-blur-md z-40">
          <div>
            <h1 className="text-xl font-black tracking-tight uppercase">ЮРИДИЧЕСКИЙ РИСК-МЕНЕДЖМЕНТ <span className="text-cyan-400">V2.4</span></h1>
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold">Проверка юридических рисков - Сделаем твой юридический путь безопасным вместе!</p>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white/40">УРОВЕНЬ</span>
                <span className="text-lg font-black text-cyan-400">{state.user.level}</span>
              </div>
              <div className="w-32 h-1.5 bg-white/5 rounded-full mt-1 overflow-hidden">
                <div className="h-full w-2/3 bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
              </div>
            </div>
            
            <button onClick={() => setActiveTab('profile')} className="h-10 w-10 rounded-full border border-white/10 p-0.5 hover:border-cyan-500 transition-colors">
              <img src={state.user.avatar} alt="Avatar" className="rounded-full" />
            </button>
          </div>
        </header>

        <div className="p-12 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-12 gap-8"
              >
                {/* Left Column: Calendar & Activity */}
                <div className="col-span-12 lg:col-span-4 space-y-8">
                  {/* Calendar Integrated into Dashboard */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <CalendarIcon className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Дедлайны</h3>
                      </div>
                      <button className="text-[10px] font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest">Март 2026</button>
                    </div>
                    
                    <div className="grid grid-cols-7 gap-px bg-white/5 border border-white/5 rounded-xl overflow-hidden">
                      {['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map(day => (
                        <div key={day} className="bg-black/40 p-2 text-center text-[8px] font-bold text-white/40 uppercase tracking-widest">{day}</div>
                      ))}
                      {Array.from({ length: 31 }).map((_, i) => (
                        <div key={i} className={cn(
                          "bg-[#0A0A0A] p-2 min-h-[40px] relative group hover:bg-white/[0.02] transition-colors",
                          i === 21 && "bg-rose-500/5"
                        )}>
                          <span className={cn("text-[10px] font-bold", i === 21 ? "text-rose-400" : "text-white/20")}>{i + 1}</span>
                          {i === 21 && <div className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-rose-500" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">22 Марта: Отчет ПДн</p>
                      </div>
                    </div>
                  </div>

                  {/* Activity History */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center gap-3 mb-8">
                      <Zap className="w-5 h-5 text-yellow-500" />
                      <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Активность</h3>
                    </div>
                    <div className="space-y-6">
                      {state.activityLogs.slice(0, 3).map((log) => (
                        <div key={log.id} className="flex gap-4 items-start">
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                            log.type === 'quest' ? "bg-cyan-500" : log.type === 'task' ? "bg-yellow-500" : "bg-violet-500"
                          )} />
                          <div>
                            <p className="text-xs font-medium leading-tight">{log.action}</p>
                            <p className="text-[9px] text-white/20 mt-1 uppercase tracking-wider">{log.timestamp}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column: Main Stats & Tasks */}
                <div className="col-span-12 lg:col-span-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Health Score Card */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Shield className="w-24 h-24" />
                      </div>
                      
                      <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest mb-8">Прочность</h3>
                      
                      <div className="relative flex items-center justify-center mb-8">
                        <svg className="w-40 h-40 transform -rotate-90">
                          <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-white/5" />
                          <motion.circle
                            cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="10" fill="transparent"
                            strokeDasharray={452.39}
                            initial={{ strokeDashoffset: 452.39 }}
                            animate={{ strokeDashoffset: 452.39 - (452.39 * state.healthScore) / 100 }}
                            className="text-cyan-500" strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-5xl font-black">{state.healthScore}%</span>
                        </div>
                      </div>

                      <p className="text-xs text-white/60 text-center leading-relaxed mb-6">
                        {state.healthScore >= 80 ? (
                          <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.9 + 5)}% конкурентов в сегменте. <span className="text-emerald-400 font-bold">Отлично!</span></>
                        ) : state.healthScore >= 50 ? (
                          <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.8 + 2)}% конкурентов в сегменте. <span className="text-yellow-400 font-bold">Хорошо, но есть риски.</span></>
                        ) : (
                          <>Ваш бизнес защищен лучше, чем у {Math.floor(state.healthScore * 0.7)}% конкурентов в сегменте. <span className="text-rose-400 font-bold">Критично!</span></>
                        )}
                      </p>

                      <button 
                        onClick={() => setActiveTab('quest')}
                        className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 group/btn"
                      >
                        Продолжайте квест!
                        <ChevronRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                      </button>
                    </div>

                    {/* Category Risk Indicators */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Сектора</h3>
                        <Badge variant="neon">Max 24</Badge>
                      </div>
                      <div className="space-y-4">
                        {[
                          { label: 'HR', score: state.categoryScores.hr, color: 'bg-cyan-500' },
                          { label: 'Инфо', score: state.categoryScores.infosec, color: 'bg-violet-500' },
                          { label: 'Суд', score: state.categoryScores.court, color: 'bg-rose-500' },
                          { label: 'Налог', score: state.categoryScores.tax, color: 'bg-yellow-500' },
                        ].map((cat, idx) => (
                          <div key={idx}>
                            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-1.5">
                              <span className="text-white/40">{cat.label}</span>
                              <span className="text-white">{cat.score}</span>
                            </div>
                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${(cat.score / 24) * 100}%` }}
                                className={cn("h-full", cat.color)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Task Backlog */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <ClipboardList className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest">Задачи</h3>
                      </div>
                      <button onClick={() => setIsTaskModalOpen(true)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {state.tasks.slice(0, 4).map((task) => (
                        <div key={task.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center gap-4">
                          <button onClick={() => toggleTask(task.id)} className={cn("w-5 h-5 rounded border flex items-center justify-center", task.status === 'done' ? "bg-emerald-500 border-emerald-500" : "border-white/20")}>
                            {task.status === 'done' && <CheckCircle2 className="w-3 h-3 text-black" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <h4 className={cn("font-bold text-xs truncate", task.status === 'done' && "line-through opacity-50")}>{task.title}</h4>
                            {task.deadline && (
                              <div className="flex items-center gap-1 mt-1">
                                <CalendarIcon className="w-2 h-2 text-white/40" />
                                <span className="text-[8px] text-white/40 uppercase tracking-widest">{task.deadline}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'quest' && (
              <motion.div 
                key="quest"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="max-w-4xl mx-auto py-12"
              >
                {!state.selectedQuestCategory && state.segment === 'small' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="col-span-full text-center mb-12">
                      <h2 className="text-4xl font-black mb-4">Выберите направление аудита</h2>
                      <p className="text-white/40">Каждый блок содержит критические вопросы для вашего бизнеса</p>
                    </div>
                    {[
                      { id: 'hr', label: 'Человеческие ресурсы', icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10', desc: 'Найм, ГПХ, самозанятые и ТК РФ' },
                      { id: 'infosec', label: 'Инфобез', icon: Shield, color: 'text-violet-400', bg: 'bg-violet-500/10', desc: 'Персональные данные и коммерческая тайна' },
                      { id: 'court', label: 'Суды', icon: Gavel, color: 'text-rose-400', bg: 'bg-rose-500/10', desc: 'Договорная работа и судебные риски' },
                      { id: 'tax', label: 'Налоги', icon: Receipt, color: 'text-yellow-400', bg: 'bg-yellow-500/10', desc: 'Дробление бизнеса и налоговый комплаенс' },
                    ].map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setState(s => ({ ...s, selectedQuestCategory: cat.id as any, questStep: 0, isQuestCompleted: false }))}
                        className="group p-10 rounded-[40px] bg-white/[0.02] border border-white/5 hover:border-white/20 transition-all text-left relative overflow-hidden"
                      >
                        <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform", cat.bg)}>
                          <cat.icon className={cn("w-8 h-8", cat.color)} />
                        </div>
                        <h3 className="text-2xl font-bold mb-4">{cat.label}</h3>
                        <p className="text-white/40 leading-relaxed">{cat.desc}</p>
                        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity">
                          <cat.icon className="w-24 h-24" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  state.questStep >= questions.length ? (
                    <div className="bg-white/[0.02] border border-white/5 rounded-[48px] p-12 text-center max-w-2xl mx-auto">
                      <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-8">
                        <CheckCircle className="w-12 h-12 text-emerald-400" />
                      </div>
                      <h2 className="text-4xl font-black mb-4">Квест пройден!</h2>
                      <p className="text-white/40 mb-12 max-w-md mx-auto">
                        Вы ответили на все вопросы. Для более глубокого анализа и выявления скрытых коллизий, загрузите основной регламент по этой теме.
                      </p>
                      
                      <div className="max-w-md mx-auto p-8 rounded-3xl border-2 border-dashed border-white/10 bg-white/[0.01] mb-12">
                        <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                          <Upload className="w-6 h-6 text-cyan-400" />
                        </div>
                        <h4 className="text-sm font-bold mb-2">Загрузите итоговый документ</h4>
                        <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest mb-6">Внимание: Поддерживается только формат PDF</p>
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="px-8 py-4 bg-cyan-500 text-black font-bold rounded-2xl hover:scale-105 transition-all shadow-lg shadow-cyan-500/20"
                        >
                          {isAnalyzing ? 'Анализ...' : 'Выбрать PDF'}
                        </button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileUpload}
                          className="hidden" 
                          accept=".pdf"
                        />
                      </div>

                      <div className="flex gap-4 justify-center">
                        <button 
                          onClick={() => setState(s => ({ ...s, selectedQuestCategory: null, questStep: 0 }))}
                          className="px-8 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold transition-all"
                        >
                          К выбору категорий
                        </button>
                        <button 
                          onClick={completeQuest}
                          className="px-8 py-4 bg-violet-500 text-white font-bold rounded-2xl hover:scale-105 transition-all shadow-lg shadow-violet-500/20"
                        >
                          Перейти к результатам (Матрица)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={cn(
                      "bg-white/[0.02] border border-white/5 rounded-3xl p-12 relative overflow-hidden max-w-2xl mx-auto",
                      state.segment === 'large' && "border-violet-500/20 bg-violet-500/[0.02]"
                    )}>
                      <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                        <motion.div 
                          className={cn("h-full", state.segment === 'small' ? "bg-cyan-500" : "bg-violet-500")}
                          initial={{ width: 0 }}
                          animate={{ width: `${(state.questStep / questions.length) * 100}%` }}
                        />
                      </div>

                      <div className="mb-12">
                        <div className="flex items-center justify-between mb-4">
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-[0.2em] block",
                            state.segment === 'small' ? "text-cyan-400" : "text-violet-400"
                          )}>
                            {state.segment === 'small' ? 'Диагностический квест' : 'Анализ регламентов'} • {state.questStep + 1} / {questions.length}
                          </span>
                          {state.selectedQuestCategory && (
                            <button 
                              onClick={() => setState(s => ({ ...s, selectedQuestCategory: null }))}
                              className="text-[10px] font-bold text-white/20 hover:text-white uppercase tracking-widest transition-colors"
                            >
                              Сменить категорию
                            </button>
                          )}
                        </div>
                        <h2 className="text-3xl font-bold leading-tight">
                          {state.segment === 'large' && <span className="text-violet-400 block text-sm mb-2 uppercase tracking-widest">Давай разберемся с твоими регламентами:</span>}
                          {currentQuestion.text}
                        </h2>
                        
                        {/* Document Upload in Quest */}
                        {currentQuestion.requiresUpload && (
                          <div className="mt-8 p-8 rounded-3xl border-2 border-dashed border-white/10 bg-white/[0.01] text-center">
                            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                              <Upload className="w-6 h-6 text-violet-400" />
                            </div>
                            <h4 className="text-sm font-bold mb-2">Загрузите документ для анализа</h4>
                            <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest mb-6">Внимание: Поддерживается только формат PDF</p>
                            <button 
                              onClick={() => fileInputRef.current?.click()}
                              className="px-6 py-3 bg-violet-500 hover:bg-violet-600 rounded-2xl text-xs font-bold transition-all shadow-lg shadow-violet-500/20"
                            >
                              Выбрать PDF
                            </button>
                            <input 
                              type="file" 
                              ref={fileInputRef} 
                              onChange={handleFileUpload}
                              className="hidden" 
                              accept=".pdf"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        {currentQuestion.options.map((option, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleQuestAnswer(option.impact, option.risk)}
                            className={cn(
                              "p-6 rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] text-left transition-all group flex items-center justify-between",
                              state.segment === 'small' ? "hover:border-cyan-500/50" : "hover:border-violet-500/50"
                            )}
                          >
                            <span className={cn(
                              "font-medium transition-colors",
                              state.segment === 'small' ? "group-hover:text-cyan-400" : "group-hover:text-violet-400"
                            )}>{option.text}</span>
                            <ChevronRight className={cn(
                              "w-5 h-5 text-white/20 group-hover:translate-x-1 transition-all",
                              state.segment === 'small' ? "group-hover:text-cyan-400" : "group-hover:text-violet-400"
                            )} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </motion.div>
            )}

            {activeTab === 'audit' && (
              <motion.div 
                key="audit"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-12 gap-8"
              >
                {state.segment === 'small' ? (
                  <>
                    <div className="col-span-12 lg:col-span-5 flex flex-col gap-8">
                      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest mb-6">Модуль глубокой проверки</h3>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileUpload} 
                          className="hidden" 
                          accept=".pdf"
                        />
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className={cn(
                            "aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all cursor-pointer group",
                            (isAnalyzing || isExtracting) ? "border-cyan-500/50 bg-cyan-500/5 cursor-wait" : "border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5"
                          )}
                        >
                          <div className={cn(
                            "p-4 rounded-full transition-colors",
                            (isAnalyzing || isExtracting) ? "bg-cyan-500/20 animate-pulse" : "bg-white/5 group-hover:bg-cyan-500/20"
                          )}>
                            <Upload className={cn("w-8 h-8", (isAnalyzing || isExtracting) ? "text-cyan-400" : "text-white/20 group-hover:text-cyan-400")} />
                          </div>
                          <div className="text-center px-4">
                            <p className="font-bold text-sm">
                              {isExtracting ? 'Распознавание...' : isAnalyzing ? 'AI Анализ...' : 'Загрузите документ'}
                            </p>
                            <p className="text-[10px] text-rose-400 font-bold uppercase tracking-wider mt-1">Внимание: Только PDF до 10MB</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest mb-6">OCR Обработка</h3>
                        <div className="flex flex-col gap-4">
                          {[
                            { label: 'Распознавание текста', progress: isExtracting ? 45 : (isAnalyzing || extractedClauses.length > 0 ? 100 : 0) },
                            { label: 'Извлечение сущностей', progress: isExtracting ? 0 : (isAnalyzing || extractedClauses.length > 0 ? 100 : 0) },
                            { label: 'Анализ пунктов', progress: isAnalyzing ? 65 : (extractedClauses.length > 0 && !isAnalyzing ? 100 : 0) },
                          ].map((item, idx) => (
                            <div key={idx}>
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider mb-2">
                                <span className="text-white/40">{item.label}</span>
                                <span className="text-cyan-400">{item.progress}%</span>
                              </div>
                              <ProgressBar value={item.progress} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="col-span-12 lg:col-span-7 bg-white/[0.02] border border-white/5 rounded-3xl p-8 font-mono text-xs leading-relaxed overflow-hidden relative min-h-[400px]">
                      <div className="absolute top-0 right-0 p-4">
                        <Badge variant="neon">{isExtracting ? 'OCR' : isAnalyzing ? 'AI Анализ' : 'Ожидание'}</Badge>
                      </div>
                      <div className="text-white/40 mb-4"># DOCUMENT_STREAM_ID: {isExtracting || isAnalyzing ? '882-XQ' : '---'}</div>
                      
                      {isExtracting && (
                        <div className="flex flex-col items-center justify-center h-full py-20 text-white/20">
                          <Loader2 className="w-12 h-12 animate-spin mb-4" />
                          <p className="uppercase tracking-widest text-[10px] font-bold">Сканирование документа...</p>
                        </div>
                      )}

                      {!isExtracting && extractedClauses.length > 0 && (
                        <div className="space-y-4">
                          <div className="p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
                            <h4 className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-3">Извлеченные данные:</h4>
                            <div className="space-y-2">
                              {extractedClauses.map((clause, i) => (
                                <motion.p 
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.1 }}
                                  key={i} 
                                  className="text-white/70"
                                >
                                  <span className="text-cyan-500/40 mr-2">»</span> {clause}
                                </motion.p>
                              ))}
                            </div>
                          </div>

                          {isAnalyzing && (
                            <div className="flex items-center gap-3 text-violet-400 animate-pulse">
                              <Shield className="w-4 h-4" />
                              <span className="text-[10px] font-bold uppercase tracking-widest">ИИ проверяет соответствие регламентам...</span>
                            </div>
                          )}

                          {!isAnalyzing && state.risks.some(r => r.id.startsWith('r-audit')) && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-400"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4" />
                                <span className="font-bold uppercase text-[10px] tracking-widest">Выявлена коллизия</span>
                              </div>
                              <p>{state.risks.filter(r => r.id.startsWith('r-audit')).sort((a, b) => b.id.localeCompare(a.id))[0]?.description}</p>
                            </motion.div>
                          )}
                        </div>
                      )}

                      {!isExtracting && extractedClauses.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full py-20 text-white/10">
                          <FileSearch className="w-16 h-16 mb-4" />
                          <p className="uppercase tracking-widest text-[10px] font-bold">Загрузите документ для начала проверки</p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="col-span-12 space-y-8">
                    {!state.activeFolderId ? (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-2xl font-bold">Управление регламентами</h3>
                            <p className="text-sm text-white/40">Добавляйте и сравнивайте внутренние политики компании</p>
                          </div>
                          <button 
                            onClick={handleCompareAll}
                            className="px-6 py-3 bg-violet-500 hover:bg-violet-600 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-violet-500/20"
                          >
                            <Search className="w-4 h-4" />
                            Сравнить все
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {DOCUMENT_CATEGORIES.map(cat => {
                            const docCount = state.regulations.filter(r => r.category === cat.id).length;
                            return (
                              <button
                                key={cat.id}
                                onClick={() => setState(s => ({ ...s, activeFolderId: cat.id }))}
                                className="group p-8 rounded-[32px] bg-white/[0.02] border border-white/5 hover:border-violet-500/30 transition-all text-left relative overflow-hidden"
                              >
                                <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                  <cat.icon className="w-7 h-7 text-violet-400" />
                                </div>
                                <h4 className="text-lg font-bold mb-2">{cat.title}</h4>
                                <div className="flex items-center gap-2 text-white/40 text-xs">
                                  <FileText className="w-3 h-3" />
                                  <span>{docCount} документов</span>
                                </div>
                                <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-5 transition-opacity">
                                  <cat.icon className="w-20 h-20" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-8">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => setState(s => ({ ...s, activeFolderId: null }))}
                            className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                          >
                            <ArrowLeft className="w-5 h-5" />
                          </button>
                          <div>
                            <h3 className="text-2xl font-bold">
                              {DOCUMENT_CATEGORIES.find(c => c.id === state.activeFolderId)?.title}
                            </h3>
                            <p className="text-sm text-white/40">Загруженные документы и выявленные риски</p>
                          </div>
                          <div className="ml-auto">
                            <button 
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isAnalyzing || isExtracting}
                              className={cn(
                                "px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-bold transition-all flex items-center gap-2",
                                (isAnalyzing || isExtracting) && "opacity-50 cursor-wait"
                              )}
                            >
                              {(isAnalyzing || isExtracting) ? (
                                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                              ) : (
                                <Upload className="w-4 h-4 text-violet-400" />
                              )}
                              {(isAnalyzing || isExtracting) ? 'Обработка...' : 'Загрузить документ'}
                            </button>
                            <input 
                              type="file" 
                              ref={fileInputRef} 
                              onChange={(e) => handleFolderUpload(e, state.activeFolderId!)}
                              className="hidden" 
                              accept=".pdf"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                          {state.regulations.filter(r => r.category === state.activeFolderId).length === 0 ? (
                            <div className="py-20 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-3xl">
                              <Folder className="w-12 h-12 text-white/10 mx-auto mb-4" />
                              <p className="text-white/40">В этой папке пока нет документов</p>
                            </div>
                          ) : (
                            state.regulations
                              .filter(r => r.category === state.activeFolderId)
                              .map(doc => (
                                <div key={doc.id} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                                  <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-4">
                                      <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
                                        <FileText className="w-6 h-6 text-violet-400" />
                                      </div>
                                      <div>
                                        <h4 className="font-bold">{doc.title}</h4>
                                        <p className="text-xs text-white/40">Загружено: {doc.lastUpdated}</p>
                                      </div>
                                    </div>
                                    <Badge variant={doc.risks && doc.risks.length > 0 ? 'danger' : 'neon'}>
                                      {doc.risks && doc.risks.length > 0 ? `${doc.risks.length} рисков` : 'Чисто'}
                                    </Badge>
                                  </div>
                                  
                                  {doc.risks && doc.risks.length > 0 && (
                                    <div className="space-y-3 mt-4 pt-4 border-t border-white/5">
                                      {doc.risks.map(risk => (
                                        <div key={risk.id} className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/10">
                                          <div className="flex items-center gap-2 mb-1">
                                            <AlertCircle className="w-3 h-3 text-rose-400" />
                                            <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">{risk.title}</span>
                                          </div>
                                          <p className="text-xs text-white/60 leading-relaxed">{risk.description}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'matrix' && (
              <motion.div 
                key="matrix"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-8"
              >
                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8">
                  <div className="flex items-center justify-between mb-12">
                    <div>
                      <h3 className="text-xl font-bold">Матрица рисков</h3>
                      <p className="text-xs text-white/40">Визуализация вероятности и ущерба выявленных угроз</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-rose-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Критично</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-orange-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Высокий</span>
                      </div>
                    </div>
                  </div>

                  <div className="h-[400px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <XAxis 
                          type="number" 
                          dataKey="probability" 
                          name="Probability" 
                          unit="%" 
                          domain={[0, 100]} 
                          stroke="#333"
                          label={{ value: 'Вероятность', position: 'bottom', fill: '#666', fontSize: 10 }}
                        />
                        <YAxis 
                          type="number" 
                          dataKey="impact" 
                          name="Impact" 
                          unit="%" 
                          domain={[0, 100]} 
                          stroke="#333"
                          label={{ value: 'Ущерб', angle: -90, position: 'left', fill: '#666', fontSize: 10 }}
                        />
                        <ZAxis type="number" dataKey="impact" range={[100, 1000]} />
                        <Tooltip 
                          cursor={{ strokeDasharray: '3 3' }} 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-black/90 border border-white/10 p-4 rounded-xl backdrop-blur-md shadow-2xl">
                                  <p className="font-bold text-sm mb-1">{data.title}</p>
                                  <p className="text-[10px] text-white/40 mb-2">{data.description}</p>
                                  <div className="flex items-center gap-4">
                                    <div className="text-[10px]">
                                      <span className="text-white/40 block">Вер-ть</span>
                                      <span className="font-bold">{data.probability}%</span>
                                    </div>
                                    <div className="text-[10px]">
                                      <span className="text-white/40 block">Ущерб</span>
                                      <span className="font-bold">{data.impact}%</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter name="Risks" data={state.risks}>
                          {state.risks.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.severity === 'Критично' ? '#f43f5e' : entry.severity === 'Высокий' ? '#fb923c' : '#eab308'} 
                              className="drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                            />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Risk Detailed List with Lexi Chat */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {state.risks.map((risk) => (
                    <div key={risk.id} className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <Badge variant={risk.severity === 'Критично' ? 'danger' : 'warning'}>{risk.severity}</Badge>
                          <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">{risk.category}</span>
                        </div>
                        <h4 className="text-lg font-bold mb-2">{risk.title}</h4>
                        <p className="text-sm text-white/40 mb-6">{risk.description}</p>
                      </div>
                      
                      <div className="flex gap-3">
                        <button 
                          onClick={() => { setSelectedRisk(risk); setIsActionPlanOpen(true); }}
                          className="flex-1 py-3 bg-cyan-500 text-black text-xs font-bold rounded-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                        >
                          Исправить <ArrowRight className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => openLexi(risk)}
                          className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group"
                        >
                          <MessageSquare className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'profile' && (
              <motion.div 
                key="profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="max-w-4xl mx-auto"
              >
                <div className="bg-white/[0.02] border border-white/5 rounded-[40px] p-12 flex flex-col md:flex-row gap-12 items-center">
                  <div className="relative">
                    <div className="w-48 h-48 rounded-full border-4 border-cyan-500/20 p-2">
                      <img src={state.user.avatar} alt="Avatar" className="w-full h-full rounded-full" />
                    </div>
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-cyan-500 text-black text-xs font-black rounded-full">
                      LVL {state.user.level}
                    </div>
                  </div>

                  <div className="flex-1 text-center md:text-left">
                    <h2 className="text-4xl font-black mb-2">{state.user.name}</h2>
                    <p className="text-cyan-400 font-bold mb-6">{state.user.role} @ {state.user.company}</p>
                    
                    <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Опыт (XP)</span>
                        <span className="text-xl font-black">{state.user.xp}</span>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] text-white/40 uppercase font-bold block mb-1">Задач решено</span>
                        <span className="text-xl font-black">{state.tasks.filter(t => t.status === 'done').length}</span>
                      </div>
                    </div>

                    <div className="flex gap-4 justify-center md:justify-start">
                      <button className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold transition-colors">Редактировать</button>
                      <button className="px-6 py-3 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-xl text-sm font-bold transition-colors">Выйти</button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Task Modal */}
      <AnimatePresence>
        {isTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTaskModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Новая задача</h3>
                <button onClick={() => setIsTaskModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Название задачи</label>
                  <input 
                    type="text" 
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Например: Проверить договор аренды"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Срок исполнения</label>
                  <input 
                    type="date" 
                    value={newTaskDeadline}
                    onChange={(e) => setNewTaskDeadline(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 transition-colors text-white/70"
                  />
                </div>

                <button 
                  onClick={addTask}
                  className="w-full py-4 bg-cyan-500 text-black font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Создать задачу
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Regulation Modal */}
      <AnimatePresence>
        {isRegModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsRegModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold">Новый регламент</h3>
                <button onClick={() => setIsRegModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Название регламента</label>
                  <input 
                    type="text" 
                    value={newRegTitle}
                    onChange={(e) => setNewRegTitle(e.target.value)}
                    placeholder="Например: Положение о КТ"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2 block">Содержание регламента</label>
                  <textarea 
                    value={newRegContent}
                    onChange={(e) => setNewRegContent(e.target.value)}
                    placeholder="Введите текст регламента или его основные пункты..."
                    rows={6}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-colors resize-none"
                  />
                </div>

                <button 
                  onClick={addRegulation}
                  className="w-full py-4 bg-violet-500 text-white font-bold rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Сохранить регламент
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compare Modal */}
      <AnimatePresence>
        {isCompareModalOpen && selectedRegForCompare && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsCompareModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center justify-between mb-8 shrink-0">
                <div>
                  <h3 className="text-2xl font-bold">Сравнение регламентов</h3>
                  <p className="text-sm text-white/40">Анализ коллизий и различий между версиями</p>
                </div>
                <button onClick={() => setIsCompareModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-8 overflow-y-auto pr-4">
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                    <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">Текущий: {selectedRegForCompare.title}</span>
                  </div>
                  <div className="p-6 bg-white/[0.03] rounded-2xl border border-white/5 text-sm leading-relaxed text-white/60">
                    {selectedRegForCompare.content}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Эталонный регламент (AI)</span>
                  </div>
                  <div className="p-6 bg-white/[0.03] rounded-2xl border border-white/5 text-sm leading-relaxed text-white/60">
                    {selectedRegForCompare.content.split('\n').map((line, i) => (
                      <p key={i} className={cn(i % 3 === 0 ? "text-cyan-400/80 bg-cyan-400/5 p-1 rounded" : "")}>
                        {line}
                        {i % 3 === 0 && <span className="block text-[10px] font-bold mt-1 text-cyan-500/50 uppercase tracking-tighter">[РЕКОМЕНДАЦИЯ: Добавить пункт о форс-мажоре]</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-white/5 flex justify-end gap-4 shrink-0">
                <button 
                  onClick={() => setIsCompareModalOpen(false)}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-bold transition-colors"
                >
                  Закрыть
                </button>
                <button 
                  onClick={() => {
                    setIsCompareModalOpen(false);
                    logActivity(`Приняты изменения в регламент: ${selectedRegForCompare.title}`, 'regulation');
                  }}
                  className="px-6 py-3 bg-violet-500 text-white rounded-xl text-sm font-bold hover:scale-105 transition-all"
                >
                  Применить рекомендации
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Action Plan Modal */}
      <AnimatePresence>
        {isActionPlanOpen && selectedRisk && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsActionPlanOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[32px] p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <Badge variant="danger">{selectedRisk.severity}</Badge>
                  <h3 className="text-2xl font-bold mt-2">{selectedRisk.title}</h3>
                </div>
                <button onClick={() => setIsActionPlanOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h4 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">План действий</h4>
                  <div className="space-y-3">
                    {selectedRisk.actionPlan ? (
                      Array.isArray(selectedRisk.actionPlan) ? (
                        selectedRisk.actionPlan.map((step, i) => (
                          <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 group/step">
                            <div className="w-6 h-6 rounded-full bg-cyan-500 text-black text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                            <p className="text-sm leading-relaxed flex-1">{step}</p>
                            <button 
                              onClick={() => handleAddActionToTasks(step)}
                              className="p-2 bg-white/5 hover:bg-cyan-500 hover:text-black rounded-lg transition-all opacity-0 group-hover/step:opacity-100"
                              title="Добавить в задачи"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedRisk.actionPlan}</p>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-white/40 italic">План действий формируется...</p>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setIsActionPlanOpen(false)}
                  className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm font-bold transition-all"
                >
                  Понятно, приступаю
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lexi Chat Sidebar */}
      <AnimatePresence>
        {isLexiOpen && chatRisk && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsLexiOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110]"
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-[#121212] border-l border-white/10 z-[120] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Чат с Лекси</h3>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">Юридический ассистент</p>
                  </div>
                </div>
                <button onClick={() => setIsLexiOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                {messages.map((msg, i) => (
                  <div key={i} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
                    <div className={cn(
                      "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' ? "bg-cyan-500 text-black font-medium rounded-tr-none" : "bg-white/5 border border-white/5 rounded-tl-none"
                    )}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isLexiLoading && (
                  <div className="flex items-center gap-2 text-white/40 text-xs italic">
                    <Loader2 className="w-3 h-3 animate-spin" /> Лекси думает...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 border-t border-white/5 bg-black/20">
                <div className="relative">
                  <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLexiChat()}
                    placeholder="Задайте вопрос Лекси..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-6 pr-14 py-4 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
                  />
                  <button 
                    onClick={handleLexiChat}
                    disabled={!input.trim() || isLexiLoading}
                    className="absolute right-2 top-2 bottom-2 w-10 rounded-xl bg-cyan-500 text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#121212] border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold">Настройки системы</h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">Сегмент бизнеса</h4>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setState(s => ({ ...s, segment: 'small' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-xs font-bold transition-all",
                        state.segment === 'small' ? "bg-cyan-500 text-black" : "bg-white/5 text-white/40 hover:bg-white/10"
                      )}
                    >
                      Малый бизнес
                    </button>
                    <button 
                      onClick={() => setState(s => ({ ...s, segment: 'corporate' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-xs font-bold transition-all",
                        state.segment === 'corporate' ? "bg-violet-500 text-white" : "bg-white/5 text-white/40 hover:bg-white/10"
                      )}
                    >
                      Корпорация
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-4">Уведомления</h4>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Критические риски</span>
                    <div className="w-10 h-5 bg-cyan-500 rounded-full relative">
                      <div className="absolute right-1 top-1 bottom-1 w-3 bg-black rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <p className="text-[10px] text-white/20 text-center uppercase tracking-[0.2em]">Версия системы 2.4.1-stable</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compare All Loading Overlay */}
      <AnimatePresence>
        {isComparingAll && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative flex flex-col items-center gap-8 text-center"
            >
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Search className="w-8 h-8 text-violet-400" />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-bold mb-2">Перекрестный анализ регламентов</h3>
                <p className="text-white/40 max-w-xs mx-auto">ИИ проверяет все документы на наличие логических противоречий и правовых коллизий...</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="neon">OCR</Badge>
                <Badge variant="neon">NLP</Badge>
                <Badge variant="neon">Legal-LLM</Badge>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compare All Result Modal */}
      <AnimatePresence>
        {isCompareResultOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsCompareResultOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-[40px] p-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <CheckCircle className="w-40 h-40 text-emerald-500" />
              </div>

              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">Результат сравнения</h3>
                    <p className="text-sm text-white/40">Анализ завершен успешно</p>
                  </div>
                </div>
                <button onClick={() => setIsCompareResultOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/20">
                  <p className="text-emerald-400 font-medium leading-relaxed">
                    В ходе перекрестного анализа всех загруженных регламентов критических противоречий и правовых коллизий не выявлено. Ваши внутренние политики согласованы между собой.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Проверено документов</div>
                    <div className="text-2xl font-bold">{state.regulations.length || 12}</div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Выявлено коллизий</div>
                    <div className="text-2xl font-bold text-emerald-400">0</div>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => setIsCompareResultOpen(false)}
                    className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Понятно, спасибо
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

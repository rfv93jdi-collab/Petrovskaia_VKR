export interface Risk {
  id: string;
  title: string;
  description: string;
  probability: number; // 0-100
  impact: number; // 0-100
  severity: 'Низкий' | 'Средний' | 'Высокий' | 'Критично';
  category: string;
  status: 'open' | 'resolved';
  recommendation: string;
  actionPlan?: string | string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'done';
  points: number;
  riskId?: string;
  deadline?: string;
}

export interface QuestQuestion {
  id: string;
  text: string;
  category: 'hr' | 'infosec' | 'court' | 'tax';
  actionPlan?: string;
  requiresUpload?: boolean;
  options: {
    text: string;
    impact: number; // impact on health score
    risk?: Partial<Risk>;
  }[];
}

export interface UserProfile {
  name: string;
  company: string;
  role: string;
  level: number;
  xp: number;
  avatar: string;
}

export interface Regulation {
  id: string;
  title: string;
  content: string;
  category: string; // This will now be the folder name/id
  lastUpdated: string;
  risks?: Risk[];
}

export interface DocumentCategory {
  id: string;
  title: string;
  icon: any;
}

export interface ActivityLog {
  id: string;
  action: string;
  timestamp: string;
  user: string;
  type: 'quest' | 'audit' | 'task' | 'regulation';
}

export interface AppState {
  healthScore: number;
  risks: Risk[];
  tasks: Task[];
  regulations: Regulation[];
  activityLogs: ActivityLog[];
  categoryScores: {
    hr: number;
    infosec: number;
    court: number;
    tax: number;
  };
  segment: 'small' | 'large';
  questStep: number;
  selectedQuestCategory: 'hr' | 'infosec' | 'court' | 'tax' | null;
  isQuestCompleted: boolean;
  user: UserProfile;
  activeFolderId: string | null;
  lastUploadedDocName: string | null;
}

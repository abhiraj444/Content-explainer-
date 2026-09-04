import Dexie, { type Table } from 'dexie';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { v4 as uuidv4 } from 'uuid';

export interface LocalCase {
  id: string;
  userId: string;
  type: 'diagnosis' | 'content-generator' | 'knowledge-map';
  title: string;
  createdAt: number;
  updatedAt?: number;
  inputData: {
    patientData?: string | null;
    supportingDocuments?: string[]; // Local URLs or Base64
    structuredQuestion?: any;
    mode?: 'question' | 'topic';
    question?: string | null;
    images?: string[];
    topic?: string | null;
    topicOrQuestion?: string | null;
    sourceType?: 'pdf' | 'pyq' | 'text' | 'image';
    fromDiagnosisCaseId?: string;
    learningGoal?: string;
    [key: string]: any;
  };
  outputDataUrl?: string; // Local path to JSON
  outputData?: any; // Direct storage for simplicity in local mode
}

export interface LocalUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface LocalAudioCacheItem {
  id: string; // cacheKey (based on context/text/voice)
  audioBase64?: string;
  audioDataUrl?: string;
  mimeType?: string;
  script: string;
  voice?: string;
  provider?: string;
  audioPreference?: string;
  createdAt: number;
}

class MediGenDatabase extends Dexie {
  cases!: Table<LocalCase>;
  users!: Table<LocalUser>;
  audioCache!: Table<LocalAudioCacheItem>;

  constructor() {
    super('MediGenDB');
    this.version(1).stores({
      cases: 'id, userId, type, createdAt',
      users: 'id, email'
    });
    this.version(2).stores({
      cases: 'id, userId, type, createdAt',
      users: 'id, email',
      audioCache: 'id, createdAt'
    });
  }
}

export const db = new MediGenDatabase();

export const LocalDataService = {
  // Audio Cache Persistence (Saves generated voice explanations across sessions)
  async saveAudioCache(item: Omit<LocalAudioCacheItem, 'createdAt'> & { createdAt?: number }) {
    try {
      const data: LocalAudioCacheItem = {
        ...item,
        createdAt: item.createdAt || Date.now(),
      };
      await db.audioCache.put(data);
      return data;
    } catch (err) {
      console.warn('Failed to save audio to Dexie cache:', err);
      return null;
    }
  },

  // Spoken Script Persistence (Preserves generated scripts even if audio generation fails)
  async saveScriptCache(id: string, script: string, metadata?: { voice?: string; provider?: string; audioPreference?: string }) {
    try {
      const existing = await db.audioCache.get(id);
      const data: LocalAudioCacheItem = {
        ...existing,
        id,
        script,
        audioBase64: existing?.audioBase64 || '',
        mimeType: existing?.mimeType || 'text/plain',
        voice: metadata?.voice || existing?.voice || '',
        provider: metadata?.provider || existing?.provider || '',
        audioPreference: metadata?.audioPreference || existing?.audioPreference || '',
        createdAt: existing?.createdAt || Date.now(),
      };
      await db.audioCache.put(data);
      return data;
    } catch (err) {
      console.warn('Failed to save script to Dexie cache:', err);
      return null;
    }
  },

  async getScriptCache(id: string): Promise<string | undefined> {
    try {
      const item = await db.audioCache.get(id);
      return item?.script;
    } catch (err) {
      console.warn('Failed to get script from Dexie cache:', err);
      return undefined;
    }
  },

  async getAudioCache(id: string): Promise<LocalAudioCacheItem | undefined> {
    try {
      return await db.audioCache.get(id);
    } catch (err) {
      console.warn('Failed to get audio from Dexie cache:', err);
      return undefined;
    }
  },

  async deleteAudioCache(id: string) {
    try {
      await db.audioCache.delete(id);
    } catch (err) {
      console.warn('Failed to delete audio from Dexie cache:', err);
    }
  },

  // Case Management
  async saveCase(caseData: Partial<LocalCase>) {
    const id = caseData.id || uuidv4();
    const data = {
      ...caseData,
      id,
      createdAt: caseData.createdAt || Date.now(),
    } as LocalCase;
    await db.cases.put(data);
    return id;
  },

  async getCase(id: string) {
    return await db.cases.get(id);
  },

  async updateCase(id: string, updates: Partial<LocalCase>) {
    const existing = await db.cases.get(id);
    if (!existing) {
      return await this.saveCase({ ...updates, id });
    }
    const merged = {
      ...existing,
      ...updates,
      id,
      updatedAt: updates.updatedAt || Date.now(),
    };
    await db.cases.put(merged as LocalCase);
    return id;
  },

  async getUserCases(userId?: string) {
    const all = await db.cases.toArray();
    return all
      .filter((c) => {
        if (!userId) return true;
        return c.userId === userId || c.userId === 'local-user' || !c.userId;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  async deleteCase(id: string) {
    await db.cases.delete(id);
  },

  // File Management (Capacitor Filesystem)
  async saveFile(file: File, userId: string): Promise<string> {
    const fileName = `${uuidv4()}-${file.name}`;
    const path = `uploads/${userId}/${fileName}`;

    const base64Data = await this.fileToBase64(file);

    // On web platform, just return the data URI directly
    if (Capacitor.getPlatform() === 'web') {
      return base64Data;
    }

    // On mobile platforms, use Filesystem API
    try {
      await Filesystem.writeFile({
        path,
        data: base64Data,
        directory: Directory.Data,
        recursive: true
      });

      const result = await Filesystem.getUri({
        path,
        directory: Directory.Data
      });

      return result.uri;
    } catch (e) {
      console.error('Error saving file locally:', e);
      // Fallback to Data URI if Filesystem fails
      return base64Data;
    }
  },

  async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // User Management
  async createUser(user: LocalUser) {
    await db.users.add(user);
    return user;
  },

  async getUserByEmail(email: string) {
    return await db.users.where('email').equals(email).first();
  }
};

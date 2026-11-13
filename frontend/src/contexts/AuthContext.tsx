import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import request from '../utils/request';
import { message } from 'antd';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'hr' | 'interviewer';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (throwOnError = false) => {
    try {
      const res = await request.get('/auth/me');
      setUser(res as any);
    } catch (error) {
      localStorage.removeItem('token');
      setUser(null);
      if (throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  };

  const login = async (token: string) => {
    localStorage.setItem('token', token);
    await fetchUser(true);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    message.success('已退出登录');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser: fetchUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

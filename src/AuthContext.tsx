import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './types';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from './services/firestoreErrorHandler';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthReady: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAuthReady: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setProfile(null);
        setLoading(false);
        setIsAuthReady(true);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Listen to User Profile
  useEffect(() => {
    if (!user) return;

    const unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), async (userDoc) => {
      if (userDoc.exists()) {
        const data = userDoc.data() as UserProfile;
        const isNadeem = user.email?.toLowerCase().trim() === 'nadeemdayoub@gmail.com';
        const role = isNadeem ? 'super_admin' : (data.role || 'user');

        setProfile({ ...data, id: userDoc.id, uid: user.uid, role } as UserProfile);
      } else {
        // Virtual profile for super admin if doc doesn't exist yet
        if (user.email === 'nadeemdayoub@gmail.com') {
          setProfile({ 
            id: user.uid, 
            uid: user.uid, 
            email: user.email, 
            displayName: user.displayName || 'Super Admin',
            role: 'super_admin',
            status: 'active',
          } as UserProfile);
        } else {
          setProfile(null);
        }
      }
      setLoading(false);
      setIsAuthReady(true);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      } catch (e) {
        console.error(getFirestoreErrorMessage(e, "Failed to load user profile."));
      }
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => unsubscribeProfile();
  }, [user]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      isAuthReady 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

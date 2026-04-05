import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// Your real production configuration
const firebaseConfig = {
  apiKey: "AIzaSyDbBFjD8q47K4Z2EE1L_YEkR3mdpPYJf7k",
  authDomain: "purchasingintelligenceplatform.firebaseapp.com",
  projectId: "purchasingintelligenceplatform",
  storageBucket: "purchasingintelligenceplatform.firebasestorage.app",
  messagingSenderId: "540361743732",
  appId: "1:540361743732:web:4f8494634788e460ac6021"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
// We use the default database instance for your real project
export const db = getFirestore(app); 
export const auth = getAuth(app);
export const storage = getStorage(app);

// CRITICAL: Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'system', 'connection_test'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();

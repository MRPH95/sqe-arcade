import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// INSTRUCTIONS:
// 1. Go to console.firebase.google.com
// 2. Create a project
// 3. Add a Web App
// 4. Copy the config object here

const firebaseConfig = {
  // PASTE YOUR FIREBASE CONFIG HERE
  apiKey: "AIzaSyAwX-gswX66SRdlS3e0Pn4LfERXNVnWcJc",
  authDomain: "sqe-arcade.firebaseapp.com",
  projectId: "sqe-arcade",
  storageBucket: "sqe-arcade.firebasestorage.app",
  messagingSenderId: "40583741206",
  appId: "1:40583741206:web:f413cbf92e876d1c24da37",
  measurementId: "G-LFJJTFXRDV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };

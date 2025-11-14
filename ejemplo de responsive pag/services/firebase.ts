// Use Firebase v8 compatibility libraries to work with the modern v9+ SDK.
// This resolves the error "The requested module 'firebase/app' does not provide an export named 'default'".
import firebase from "firebase/compat/app";
import "firebase/compat/database";

const firebaseConfig = {
  apiKey: "AIzaSyBEW57R_rVXIRNolXSD3xyQ5VcKxmno2zQ",
  authDomain: "calidad-del-aire-1c28c.firebaseapp.com",
  databaseURL: "https://calidad-del-aire-1c28c-default-rtdb.firebaseio.com",
  projectId: "calidad-del-aire-1c28c",
  storageBucket: "calidad-del-aire-1c28c.firebasestorage.app",
  messagingSenderId: "937929569093",
  appId: "1:937929569093:web:538c7abcde251cb504842c"
};

// Initialize Firebase only if it hasn't been initialized yet to prevent errors during hot-reloading.
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Export the database instance using the v8 namespaced API provided by the compat library.
export const db = firebase.database();

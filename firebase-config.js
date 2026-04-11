// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCYDZVTXa5JPfsCZC05AvDyHaEtC9b4l0Y",
  authDomain: "dishtracker-e71ce.firebaseapp.com",
  databaseURL: "https://dishtracker-e71ce-default-rtdb.firebaseio.com",
  projectId: "dishtracker-e71ce",
  storageBucket: "dishtracker-e71ce.firebasestorage.app",
  messagingSenderId: "908716118801",
  appId: "1:908716118801:web:096172f202d9feb21ff2b0",
  measurementId: "G-PMLLVSRTT8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

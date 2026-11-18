"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth | null {
  if (auth) return auth;
  const {
    NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  } = process.env;
  if (!NEXT_PUBLIC_FIREBASE_API_KEY || !NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || !NEXT_PUBLIC_FIREBASE_PROJECT_ID || !NEXT_PUBLIC_FIREBASE_APP_ID) return null;

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: NEXT_PUBLIC_FIREBASE_APP_ID,
        measurementId: NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      });
  auth = getAuth(app);
  return auth;
}

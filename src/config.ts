// Public client configuration. None of these values are secrets: Firebase web config and an OAuth client ID
// are designed to ship in the browser bundle. Access is enforced by firestore.rules and by Google OAuth.

export const firebaseConfig = {
  apiKey: 'AIzaSyCcDqcpKT5-VePChfZ51h6-LgaeM6YFIuM',
  authDomain: 'labelsnap-12765.firebaseapp.com',
  projectId: 'labelsnap-12765',
  storageBucket: 'labelsnap-12765.firebasestorage.app',
  messagingSenderId: '516454366085',
  appId: '1:516454366085:web:4f68259a52de936b6562ec',
  measurementId: 'G-9XKFLNFS6Q',
};

// OAuth 2.0 Web client ID from Google Cloud console (APIs & Services → Credentials), used for Google Drive.
// Paste it here, or set VITE_GOOGLE_CLIENT_ID at build time.
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const APP_VERSION: string = __APP_VERSION__;

// Where "Report a problem" points. A mailto with no recipient opens the user's mail client.
export const REPORT_PROBLEM_URL = `mailto:?subject=${encodeURIComponent(`LabelSnap ${__APP_VERSION__} problem report`)}`;

// Days a trashed Document is kept before it is purged.
export const TRASH_RETENTION_DAYS = 30;

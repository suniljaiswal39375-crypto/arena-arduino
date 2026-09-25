/**
 * Firebase-related types for SparkLab.
 * All Firebase features are optional and flag-gated — the local lab works with zero config.
 */

export type FirebaseUserRole = 'student' | 'teacher' | 'admin';

export type FirebaseUserProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: FirebaseUserRole;
  createdAt: string;
  lastLoginAt: string;
};

export type FirebaseProjectDoc = {
  id: string;
  ownerId: string;
  name: string;
  data: unknown; // ProjectDoc JSON
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
  tags: string[];
};

export type FirebaseClassroom = {
  id: string;
  ownerId: string;
  name: string;
  joinCode: string;
  archived: boolean;
  createdAt: string;
  memberCount: number;
};

export type FirebaseClassroomMember = {
  classroomId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  displayName: string | null;
};

export type FirebaseAssignment = {
  id: string;
  classroomId: string;
  title: string;
  missionSlug: string;
  dueAt: string | null;
  createdAt: string;
};

export type FirebaseSubmission = {
  assignmentId: string;
  studentId: string;
  project: unknown;
  version: number;
  submittedAt: string;
  reviewStatus: 'submitted' | 'reviewed' | 'needs-work';
  feedback: string;
  reviewedAt: string | null;
};

export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

export function isFirebaseUserRole(value: unknown): value is FirebaseUserRole {
  return value === 'student' || value === 'teacher' || value === 'admin';
}

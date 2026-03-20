declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      google_sub: string | null;
      plan: string;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date | null;
    }
  }
}

export {};

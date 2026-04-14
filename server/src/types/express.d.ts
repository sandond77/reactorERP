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
    interface Request {
      /** The user_id that owns the data for this request.
       *  For org owners this equals req.user.id.
       *  For org members this equals the org owner's user_id.
       *  Always set by requireAuth — never trust req.body for this. */
      dataUserId: string;
    }
  }
}

export {};

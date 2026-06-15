// Tipos generados manualmente para reflejar las migraciones de supabase/migrations/.
// Backend en producción: self-host Supabase en Hetzner. El proyecto antiguo
// en supabase.com (`healauhivrjunlulrlui`) fue eliminado tras la migración —
// si en algún momento se vuelve a generar tipos automáticos, hay que apuntar
// al endpoint del self-host (o regenerar a mano con las migraciones nuevas).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "client" | "admin" | "advisor" | "agent_junior" | "agent_senior" | "agent_admin";
export type PropertyOperation = "rent" | "sale";
export type PropertyStay = "short" | "long";
export type PropertyStatus = "available" | "reserved" | "sold" | "archived";
export type PropertySource = "manual" | "scrape" | "api";
export type VisitStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type MessageSenderType = "client" | "advisor" | "admin";
export type SyncStatus = "running" | "success" | "partial" | "error";
export type FeedHealth = "healthy" | "warning" | "error" | "idle";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          email: string;
          phone: string | null;
          avatar_url: string | null;
          assigned_advisor_id: string | null;
          personal_shopper_terms_accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          full_name?: string | null;
          email: string;
          phone?: string | null;
          avatar_url?: string | null;
          assigned_advisor_id?: string | null;
          personal_shopper_terms_accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      agencies: {
        Row: {
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          website: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          website?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agencies"]["Insert"]>;
      };
      agency_partnerships: {
        Row: {
          id: string;
          agency_id: string;
          commission_pct: number | null;
          rent_commission_pct: number | null;
          sale_commission_pct: number | null;
          sale_agreed_commission_pct: number | null;
          rent_commission_min_price: number | null;
          sale_commission_min_price: number | null;
          agreement_signed_at: string | null;
          watermark_required: boolean;
          attribution_visible: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agency_id: string;
          commission_pct?: number | null;
          rent_commission_pct?: number | null;
          sale_commission_pct?: number | null;
          sale_agreed_commission_pct?: number | null;
          rent_commission_min_price?: number | null;
          sale_commission_min_price?: number | null;
          agreement_signed_at?: string | null;
          watermark_required?: boolean;
          attribution_visible?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agency_partnerships"]["Insert"]>;
      };
      properties: {
        Row: {
          id: string;
          agency_id: string | null;
          source: PropertySource;
          external_id: string | null;
          slug: string;
          title: string;
          description: string | null;
          operation: PropertyOperation;
          stay: PropertyStay | null;
          status: PropertyStatus;
          price: number;
          bedrooms: number;
          bathrooms: number;
          square_meters: number | null;
          zone: string;
          subzone: string | null;
          address: string | null;
          available_from: string | null;
          features: string[];
          features_manual: string[];
          bc_reference: string;
          cover_photo_url: string | null;
          source_url: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          owner_email: string | null;
          internal_notes: string | null;
          property_type: string | null;
          building_features: Json | null;
          latitude: number | null;
          longitude: number | null;
          geocoded_at: string | null;
          last_synced_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agency_id?: string | null;
          source?: PropertySource;
          external_id?: string | null;
          slug: string;
          title: string;
          description?: string | null;
          operation: PropertyOperation;
          stay?: PropertyStay | null;
          status?: PropertyStatus;
          price: number;
          bedrooms?: number;
          bathrooms?: number;
          square_meters?: number | null;
          zone: string;
          subzone?: string | null;
          address?: string | null;
          available_from?: string | null;
          features?: string[];
          features_manual?: string[];
          bc_reference?: string;
          cover_photo_url?: string | null;
          source_url?: string | null;
          owner_name?: string | null;
          owner_phone?: string | null;
          owner_email?: string | null;
          internal_notes?: string | null;
          property_type?: string | null;
          building_features?: Json | null;
          latitude?: number | null;
          longitude?: number | null;
          geocoded_at?: string | null;
          last_synced_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["properties"]["Insert"]>;
      };
      property_photos: {
        Row: {
          id: string;
          property_id: string;
          url: string;
          alt: string | null;
          position: number;
          is_cover: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          url: string;
          alt?: string | null;
          position?: number;
          is_cover?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["property_photos"]["Insert"]>;
      };
      client_tags: {
        Row: {
          id: string;
          name: string;
          category: string | null;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category?: string | null;
          color?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_tags"]["Insert"]>;
      };
      client_tag_assignments: {
        Row: {
          client_id: string;
          tag_id: string;
          assigned_by: string | null;
          assigned_at: string;
        };
        Insert: {
          client_id: string;
          tag_id: string;
          assigned_by?: string | null;
          assigned_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_tag_assignments"]["Insert"]>;
      };
      client_preferences: {
        Row: {
          client_id: string;
          operation: PropertyOperation | null;
          stay: PropertyStay | null;
          min_price: number | null;
          max_price: number | null;
          min_bedrooms: number | null;
          max_bedrooms: number | null;
          min_bathrooms: number | null;
          min_square_meters: number | null;
          max_square_meters: number | null;
          zones: string[];
          available_from: string | null;
          notes: string | null;
          occupants: number | null;
          students: number | null;
          workers: number | null;
          pets: boolean;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          operation?: PropertyOperation | null;
          stay?: PropertyStay | null;
          min_price?: number | null;
          max_price?: number | null;
          min_bedrooms?: number | null;
          max_bedrooms?: number | null;
          min_bathrooms?: number | null;
          min_square_meters?: number | null;
          max_square_meters?: number | null;
          zones?: string[];
          available_from?: string | null;
          notes?: string | null;
          occupants?: number | null;
          students?: number | null;
          workers?: number | null;
          pets?: boolean;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_preferences"]["Insert"]>;
      };
      favorites: {
        Row: {
          client_id: string;
          property_id: string;
          created_at: string;
        };
        Insert: {
          client_id: string;
          property_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["favorites"]["Insert"]>;
      };
      visit_requests: {
        Row: {
          id: string;
          client_id: string;
          property_id: string;
          requested_at: string;
          status: VisitStatus;
          notes: string | null;
          confirmed_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          property_id: string;
          requested_at: string;
          status?: VisitStatus;
          notes?: string | null;
          confirmed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["visit_requests"]["Insert"]>;
      };
      conversations: {
        Row: {
          id: string;
          client_id: string;
          last_message_at: string | null;
          unread_count_client: number;
          unread_count_advisor: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          last_message_at?: string | null;
          unread_count_client?: number;
          unread_count_advisor?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          sender_type: MessageSenderType;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          sender_type: MessageSenderType;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      internal_notes: {
        Row: {
          id: string;
          client_id: string;
          author_id: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          author_id: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["internal_notes"]["Insert"]>;
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
      };
      agency_feeds: {
        Row: {
          id: string;
          agency_id: string;
          scraper_key: string;
          feed_url: string | null;
          active: boolean;
          frequency_hours: number;
          last_run_at: string | null;
          last_status: SyncStatus | null;
          last_error: string | null;
          health: FeedHealth;
          next_run_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agency_id: string;
          scraper_key: string;
          feed_url?: string | null;
          active?: boolean;
          frequency_hours?: number;
          last_run_at?: string | null;
          last_status?: SyncStatus | null;
          last_error?: string | null;
          health?: FeedHealth;
          next_run_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agency_feeds"]["Insert"]>;
      };
      property_shares: {
        Row: {
          id: string;
          property_id: string;
          token: string;
          label: string | null;
          created_by: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          token: string;
          label?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["property_shares"]["Insert"]>;
      };
      property_share_opens: {
        Row: {
          id: string;
          share_id: string;
          opened_at: string;
          ip: string | null;
          user_agent: string | null;
        };
        Insert: {
          id?: string;
          share_id: string;
          opened_at?: string;
          ip?: string | null;
          user_agent?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["property_share_opens"]["Insert"]>;
      };
      sync_logs: {
        Row: {
          id: string;
          feed_id: string;
          started_at: string;
          finished_at: string | null;
          status: SyncStatus;
          triggered_by: string;
          properties_seen: number;
          properties_inserted: number;
          properties_updated: number;
          properties_archived: number;
          properties_skipped: number;
          photos_processed: number;
          error_message: string | null;
          details: Json | null;
        };
        Insert: {
          id?: string;
          feed_id: string;
          started_at?: string;
          finished_at?: string | null;
          status?: SyncStatus;
          triggered_by?: string;
          properties_seen?: number;
          properties_inserted?: number;
          properties_updated?: number;
          properties_archived?: number;
          properties_skipped?: number;
          photos_processed?: number;
          error_message?: string | null;
          details?: Json | null;
        };
        Update: Partial<Database["public"]["Tables"]["sync_logs"]["Insert"]>;
      };
      team_channels: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          emoji: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          emoji?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_channels"]["Insert"]>;
      };
      team_messages: {
        Row: {
          id: string;
          channel_id: string;
          user_id: string;
          content: string;
          reply_to: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          user_id: string;
          content: string;
          reply_to?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_messages"]["Insert"]>;
      };
    };
    Enums: {
      user_role: UserRole;
      property_operation: PropertyOperation;
      property_stay: PropertyStay;
      property_status: PropertyStatus;
      property_source: PropertySource;
      visit_status: VisitStatus;
      message_sender_type: MessageSenderType;
      sync_status: SyncStatus;
      feed_health: FeedHealth;
    };
  };
};

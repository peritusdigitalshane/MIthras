export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  _realtime: {
    Tables: {
      extensions: {
        Row: {
          id: string
          inserted_at: string
          settings: Json | null
          tenant_external_id: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          id: string
          inserted_at: string
          settings?: Json | null
          tenant_external_id?: string | null
          type?: string | null
          updated_at: string
        }
        Update: {
          id?: string
          inserted_at?: string
          settings?: Json | null
          tenant_external_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extensions_tenant_external_id_fkey"
            columns: ["tenant_external_id"]
            referencedRelation: "tenants"
            referencedColumns: ["external_id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          inserted_at: string | null
          version: number
        }
        Insert: {
          inserted_at?: string | null
          version: number
        }
        Update: {
          inserted_at?: string | null
          version?: number
        }
        Relationships: []
      }
      tenants: {
        Row: {
          broadcast_adapter: string | null
          client_presence_window_ms: number | null
          external_id: string | null
          id: string
          inserted_at: string
          jwt_jwks: Json | null
          jwt_secret: string | null
          max_bytes_per_second: number
          max_channels_per_client: number
          max_client_presence_events_per_window: number | null
          max_concurrent_users: number
          max_events_per_second: number
          max_joins_per_second: number
          max_payload_size_in_kb: number | null
          max_presence_events_per_second: number | null
          migrations_ran: number | null
          name: string | null
          notify_private_alpha: boolean | null
          postgres_cdc_default: string | null
          private_only: boolean
          suspend: boolean | null
          updated_at: string
        }
        Insert: {
          broadcast_adapter?: string | null
          client_presence_window_ms?: number | null
          external_id?: string | null
          id: string
          inserted_at: string
          jwt_jwks?: Json | null
          jwt_secret?: string | null
          max_bytes_per_second?: number
          max_channels_per_client?: number
          max_client_presence_events_per_window?: number | null
          max_concurrent_users?: number
          max_events_per_second?: number
          max_joins_per_second?: number
          max_payload_size_in_kb?: number | null
          max_presence_events_per_second?: number | null
          migrations_ran?: number | null
          name?: string | null
          notify_private_alpha?: boolean | null
          postgres_cdc_default?: string | null
          private_only?: boolean
          suspend?: boolean | null
          updated_at: string
        }
        Update: {
          broadcast_adapter?: string | null
          client_presence_window_ms?: number | null
          external_id?: string | null
          id?: string
          inserted_at?: string
          jwt_jwks?: Json | null
          jwt_secret?: string | null
          max_bytes_per_second?: number
          max_channels_per_client?: number
          max_client_presence_events_per_window?: number | null
          max_concurrent_users?: number
          max_events_per_second?: number
          max_joins_per_second?: number
          max_payload_size_in_kb?: number | null
          max_presence_events_per_second?: number | null
          migrations_ran?: number | null
          name?: string | null
          notify_private_alpha?: boolean | null
          postgres_cdc_default?: string | null
          private_only?: boolean
          suspend?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  auth: {
    Tables: {
      audit_log_entries: {
        Row: {
          created_at: string | null
          id: string
          instance_id: string | null
          ip_address: string
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          id: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instance_id?: string | null
          ip_address?: string
          payload?: Json | null
        }
        Relationships: []
      }
      flow_state: {
        Row: {
          auth_code: string | null
          auth_code_issued_at: string | null
          authentication_method: string
          code_challenge: string | null
          code_challenge_method:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at: string | null
          email_optional: boolean
          id: string
          invite_token: string | null
          linking_target_id: string | null
          oauth_client_state_id: string | null
          provider_access_token: string | null
          provider_refresh_token: string | null
          provider_type: string
          referrer: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auth_code?: string | null
          auth_code_issued_at?: string | null
          authentication_method: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string | null
          email_optional?: boolean
          id: string
          invite_token?: string | null
          linking_target_id?: string | null
          oauth_client_state_id?: string | null
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type: string
          referrer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auth_code?: string | null
          auth_code_issued_at?: string | null
          authentication_method?: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string | null
          email_optional?: boolean
          id?: string
          invite_token?: string | null
          linking_target_id?: string | null
          oauth_client_state_id?: string | null
          provider_access_token?: string | null
          provider_refresh_token?: string | null
          provider_type?: string
          referrer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      identities: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          identity_data: Json
          last_sign_in_at: string | null
          provider: string
          provider_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data: Json
          last_sign_in_at?: string | null
          provider: string
          provider_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          identity_data?: Json
          last_sign_in_at?: string | null
          provider?: string
          provider_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identities_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          created_at: string | null
          id: string
          raw_base_config: string | null
          updated_at: string | null
          uuid: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          raw_base_config?: string | null
          updated_at?: string | null
          uuid?: string | null
        }
        Relationships: []
      }
      mfa_amr_claims: {
        Row: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          authentication_method: string
          created_at: string
          id: string
          session_id: string
          updated_at: string
        }
        Update: {
          authentication_method?: string
          created_at?: string
          id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mfa_amr_claims_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_challenges: {
        Row: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code: string | null
          verified_at: string | null
          web_authn_session_data: Json | null
        }
        Insert: {
          created_at: string
          factor_id: string
          id: string
          ip_address: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Update: {
          created_at?: string
          factor_id?: string
          id?: string
          ip_address?: unknown
          otp_code?: string | null
          verified_at?: string | null
          web_authn_session_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_challenges_auth_factor_id_fkey"
            columns: ["factor_id"]
            referencedRelation: "mfa_factors"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_factors: {
        Row: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name: string | null
          id: string
          last_challenged_at: string | null
          last_webauthn_challenge_data: Json | null
          phone: string | null
          secret: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid: string | null
          web_authn_credential: Json | null
        }
        Insert: {
          created_at: string
          factor_type: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status: Database["auth"]["Enums"]["factor_status"]
          updated_at: string
          user_id: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Update: {
          created_at?: string
          factor_type?: Database["auth"]["Enums"]["factor_type"]
          friendly_name?: string | null
          id?: string
          last_challenged_at?: string | null
          last_webauthn_challenge_data?: Json | null
          phone?: string | null
          secret?: string | null
          status?: Database["auth"]["Enums"]["factor_status"]
          updated_at?: string
          user_id?: string
          web_authn_aaguid?: string | null
          web_authn_credential?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_factors_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorizations: {
        Row: {
          approved_at: string | null
          authorization_code: string | null
          authorization_id: string
          client_id: string
          code_challenge: string | null
          code_challenge_method:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at: string
          expires_at: string
          id: string
          nonce: string | null
          redirect_uri: string
          resource: string | null
          response_type: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state: string | null
          status: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id: string
          client_id: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id: string
          nonce?: string | null
          redirect_uri: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          authorization_code?: string | null
          authorization_id?: string
          client_id?: string
          code_challenge?: string | null
          code_challenge_method?:
            | Database["auth"]["Enums"]["code_challenge_method"]
            | null
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string | null
          redirect_uri?: string
          resource?: string | null
          response_type?: Database["auth"]["Enums"]["oauth_response_type"]
          scope?: string
          state?: string | null
          status?: Database["auth"]["Enums"]["oauth_authorization_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorizations_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_authorizations_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_client_states: {
        Row: {
          code_verifier: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Insert: {
          code_verifier?: string | null
          created_at: string
          id: string
          provider_type: string
        }
        Update: {
          code_verifier?: string | null
          created_at?: string
          id?: string
          provider_type?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          client_name: string | null
          client_secret_hash: string | null
          client_type: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri: string | null
          created_at: string
          deleted_at: string | null
          grant_types: string
          id: string
          logo_uri: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method: string
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types: string
          id: string
          logo_uri?: string | null
          redirect_uris: string
          registration_type: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method: string
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          client_secret_hash?: string | null
          client_type?: Database["auth"]["Enums"]["oauth_client_type"]
          client_uri?: string | null
          created_at?: string
          deleted_at?: string | null
          grant_types?: string
          id?: string
          logo_uri?: string | null
          redirect_uris?: string
          registration_type?: Database["auth"]["Enums"]["oauth_registration_type"]
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_consents: {
        Row: {
          client_id: string
          granted_at: string
          id: string
          revoked_at: string | null
          scopes: string
          user_id: string
        }
        Insert: {
          client_id: string
          granted_at?: string
          id: string
          revoked_at?: string | null
          scopes: string
          user_id: string
        }
        Update: {
          client_id?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_consents_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_consents_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      one_time_tokens: {
        Row: {
          created_at: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          relates_to: string
          token_hash: string
          token_type: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          relates_to?: string
          token_hash?: string
          token_type?: Database["auth"]["Enums"]["one_time_token_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "one_time_tokens_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_tokens: {
        Row: {
          created_at: string | null
          id: number
          instance_id: string | null
          parent: string | null
          revoked: boolean | null
          session_id: string | null
          token: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          parent?: string | null
          revoked?: boolean | null
          session_id?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refresh_tokens_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_providers: {
        Row: {
          attribute_mapping: Json | null
          created_at: string | null
          entity_id: string
          id: string
          metadata_url: string | null
          metadata_xml: string
          name_id_format: string | null
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id: string
          id: string
          metadata_url?: string | null
          metadata_xml: string
          name_id_format?: string | null
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          attribute_mapping?: Json | null
          created_at?: string | null
          entity_id?: string
          id?: string
          metadata_url?: string | null
          metadata_xml?: string
          name_id_format?: string | null
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_providers_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      saml_relay_states: {
        Row: {
          created_at: string | null
          flow_state_id: string | null
          for_email: string | null
          id: string
          redirect_to: string | null
          request_id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id: string
          redirect_to?: string | null
          request_id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          flow_state_id?: string | null
          for_email?: string | null
          id?: string
          redirect_to?: string | null
          request_id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saml_relay_states_flow_state_id_fkey"
            columns: ["flow_state_id"]
            referencedRelation: "flow_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saml_relay_states_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          version: string
        }
        Insert: {
          version: string
        }
        Update: {
          version?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          aal: Database["auth"]["Enums"]["aal_level"] | null
          created_at: string | null
          factor_id: string | null
          id: string
          ip: unknown
          not_after: string | null
          oauth_client_id: string | null
          refresh_token_counter: number | null
          refresh_token_hmac_key: string | null
          refreshed_at: string | null
          scopes: string | null
          tag: string | null
          updated_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id: string
          ip?: unknown
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          aal?: Database["auth"]["Enums"]["aal_level"] | null
          created_at?: string | null
          factor_id?: string | null
          id?: string
          ip?: unknown
          not_after?: string | null
          oauth_client_id?: string | null
          refresh_token_counter?: number | null
          refresh_token_hmac_key?: string | null
          refreshed_at?: string | null
          scopes?: string | null
          tag?: string | null
          updated_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_oauth_client_id_fkey"
            columns: ["oauth_client_id"]
            referencedRelation: "oauth_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_domains: {
        Row: {
          created_at: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          domain: string
          id: string
          sso_provider_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string
          id?: string
          sso_provider_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sso_domains_sso_provider_id_fkey"
            columns: ["sso_provider_id"]
            referencedRelation: "sso_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_providers: {
        Row: {
          created_at: string | null
          disabled: boolean | null
          id: string
          resource_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          disabled?: boolean | null
          id: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          disabled?: boolean | null
          id?: string
          resource_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          aud: string | null
          banned_until: string | null
          confirmation_sent_at: string | null
          confirmation_token: string | null
          confirmed_at: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          email_change: string | null
          email_change_confirm_status: number | null
          email_change_sent_at: string | null
          email_change_token_current: string | null
          email_change_token_new: string | null
          email_confirmed_at: string | null
          encrypted_password: string | null
          id: string
          instance_id: string | null
          invited_at: string | null
          is_anonymous: boolean
          is_sso_user: boolean
          is_super_admin: boolean | null
          last_sign_in_at: string | null
          phone: string | null
          phone_change: string | null
          phone_change_sent_at: string | null
          phone_change_token: string | null
          phone_confirmed_at: string | null
          raw_app_meta_data: Json | null
          raw_user_meta_data: Json | null
          reauthentication_sent_at: string | null
          reauthentication_token: string | null
          recovery_sent_at: string | null
          recovery_token: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          aud?: string | null
          banned_until?: string | null
          confirmation_sent_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          email_change?: string | null
          email_change_confirm_status?: number | null
          email_change_sent_at?: string | null
          email_change_token_current?: string | null
          email_change_token_new?: string | null
          email_confirmed_at?: string | null
          encrypted_password?: string | null
          id?: string
          instance_id?: string | null
          invited_at?: string | null
          is_anonymous?: boolean
          is_sso_user?: boolean
          is_super_admin?: boolean | null
          last_sign_in_at?: string | null
          phone?: string | null
          phone_change?: string | null
          phone_change_sent_at?: string | null
          phone_change_token?: string | null
          phone_confirmed_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
          reauthentication_sent_at?: string | null
          reauthentication_token?: string | null
          recovery_sent_at?: string | null
          recovery_token?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      email: { Args: never; Returns: string }
      jwt: { Args: never; Returns: Json }
      role: { Args: never; Returns: string }
      uid: { Args: never; Returns: string }
    }
    Enums: {
      aal_level: "aal1" | "aal2" | "aal3"
      code_challenge_method: "s256" | "plain"
      factor_status: "unverified" | "verified"
      factor_type: "totp" | "webauthn" | "phone"
      oauth_authorization_status: "pending" | "approved" | "denied" | "expired"
      oauth_client_type: "public" | "confidential"
      oauth_registration_type: "dynamic" | "manual"
      oauth_response_type: "code"
      one_time_token_type:
        | "confirmation_token"
        | "reauthentication_token"
        | "recovery_token"
        | "email_change_token_new"
        | "email_change_token_current"
        | "phone_change_token"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  cron: {
    Tables: {
      job: {
        Row: {
          active: boolean
          command: string
          database: string
          jobid: number
          jobname: string | null
          nodename: string
          nodeport: number
          schedule: string
          username: string
        }
        Insert: {
          active?: boolean
          command: string
          database?: string
          jobid?: number
          jobname?: string | null
          nodename?: string
          nodeport?: number
          schedule: string
          username?: string
        }
        Update: {
          active?: boolean
          command?: string
          database?: string
          jobid?: number
          jobname?: string | null
          nodename?: string
          nodeport?: number
          schedule?: string
          username?: string
        }
        Relationships: []
      }
      job_run_details: {
        Row: {
          command: string | null
          database: string | null
          end_time: string | null
          job_pid: number | null
          jobid: number | null
          return_message: string | null
          runid: number
          start_time: string | null
          status: string | null
          username: string | null
        }
        Insert: {
          command?: string | null
          database?: string | null
          end_time?: string | null
          job_pid?: number | null
          jobid?: number | null
          return_message?: string | null
          runid?: number
          start_time?: string | null
          status?: string | null
          username?: string | null
        }
        Update: {
          command?: string | null
          database?: string | null
          end_time?: string | null
          job_pid?: number | null
          jobid?: number | null
          return_message?: string | null
          runid?: number
          start_time?: string | null
          status?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      alter_job: {
        Args: {
          active?: boolean
          command?: string
          database?: string
          job_id: number
          schedule?: string
          username?: string
        }
        Returns: undefined
      }
      schedule:
        | {
            Args: { command: string; job_name: string; schedule: string }
            Returns: number
          }
        | { Args: { command: string; schedule: string }; Returns: number }
      schedule_in_database: {
        Args: {
          active?: boolean
          command: string
          database: string
          job_name: string
          schedule: string
          username?: string
        }
        Returns: number
      }
      unschedule:
        | { Args: { job_id: number }; Returns: boolean }
        | { Args: { job_name: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  extensions: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      pg_stat_statements: {
        Row: {
          blk_read_time: number | null
          blk_write_time: number | null
          calls: number | null
          dbid: unknown
          jit_emission_count: number | null
          jit_emission_time: number | null
          jit_functions: number | null
          jit_generation_time: number | null
          jit_inlining_count: number | null
          jit_inlining_time: number | null
          jit_optimization_count: number | null
          jit_optimization_time: number | null
          local_blks_dirtied: number | null
          local_blks_hit: number | null
          local_blks_read: number | null
          local_blks_written: number | null
          max_exec_time: number | null
          max_plan_time: number | null
          mean_exec_time: number | null
          mean_plan_time: number | null
          min_exec_time: number | null
          min_plan_time: number | null
          plans: number | null
          query: string | null
          queryid: number | null
          rows: number | null
          shared_blks_dirtied: number | null
          shared_blks_hit: number | null
          shared_blks_read: number | null
          shared_blks_written: number | null
          stddev_exec_time: number | null
          stddev_plan_time: number | null
          temp_blk_read_time: number | null
          temp_blk_write_time: number | null
          temp_blks_read: number | null
          temp_blks_written: number | null
          toplevel: boolean | null
          total_exec_time: number | null
          total_plan_time: number | null
          userid: unknown
          wal_bytes: number | null
          wal_fpi: number | null
          wal_records: number | null
        }
        Relationships: []
      }
      pg_stat_statements_info: {
        Row: {
          dealloc: number | null
          stats_reset: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      algorithm_sign: {
        Args: { algorithm: string; secret: string; signables: string }
        Returns: string
      }
      dearmor: { Args: { "": string }; Returns: string }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      pg_stat_statements: {
        Args: { showtext: boolean }
        Returns: Record<string, unknown>[]
      }
      pg_stat_statements_info: { Args: never; Returns: Record<string, unknown> }
      pg_stat_statements_reset: {
        Args: { dbid?: unknown; queryid?: number; userid?: unknown }
        Returns: undefined
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      sign: {
        Args: { algorithm?: string; payload: Json; secret: string }
        Returns: string
      }
      try_cast_double: { Args: { inp: string }; Returns: number }
      url_decode: { Args: { data: string }; Returns: string }
      url_encode: { Args: { data: string }; Returns: string }
      uuid_generate_v1: { Args: never; Returns: string }
      uuid_generate_v1mc: { Args: never; Returns: string }
      uuid_generate_v3: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_generate_v4: { Args: never; Returns: string }
      uuid_generate_v5: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_nil: { Args: never; Returns: string }
      uuid_ns_dns: { Args: never; Returns: string }
      uuid_ns_oid: { Args: never; Returns: string }
      uuid_ns_url: { Args: never; Returns: string }
      uuid_ns_x500: { Args: never; Returns: string }
      verify: {
        Args: { algorithm?: string; secret: string; token: string }
        Returns: {
          header: Json
          payload: Json
          valid: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  graphql: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _internal_resolve: {
        Args: {
          extensions?: Json
          operationName?: string
          query: string
          variables?: Json
        }
        Returns: Json
      }
      comment_directive: { Args: { comment_: string }; Returns: Json }
      exception: { Args: { message: string }; Returns: string }
      get_schema_version: { Args: never; Returns: number }
      resolve: {
        Args: {
          extensions?: Json
          operationName?: string
          query: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  net: {
    Tables: {
      _http_response: {
        Row: {
          content: string | null
          content_type: string | null
          created: string
          error_msg: string | null
          headers: Json | null
          id: number | null
          status_code: number | null
          timed_out: boolean | null
        }
        Insert: {
          content?: string | null
          content_type?: string | null
          created?: string
          error_msg?: string | null
          headers?: Json | null
          id?: number | null
          status_code?: number | null
          timed_out?: boolean | null
        }
        Update: {
          content?: string | null
          content_type?: string | null
          created?: string
          error_msg?: string | null
          headers?: Json | null
          id?: number | null
          status_code?: number | null
          timed_out?: boolean | null
        }
        Relationships: []
      }
      http_request_queue: {
        Row: {
          body: string | null
          headers: Json
          id: number
          method: string
          timeout_milliseconds: number
          url: string
        }
        Insert: {
          body?: string | null
          headers: Json
          id?: number
          method: string
          timeout_milliseconds: number
          url: string
        }
        Update: {
          body?: string | null
          headers?: Json
          id?: number
          method?: string
          timeout_milliseconds?: number
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _await_response: { Args: { request_id: number }; Returns: boolean }
      _encode_url_with_params_array: {
        Args: { params_array: string[]; url: string }
        Returns: string
      }
      _http_collect_response: {
        Args: { async?: boolean; request_id: number }
        Returns: Database["net"]["CompositeTypes"]["http_response_result"]
        SetofOptions: {
          from: "*"
          to: "http_response_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _urlencode_string: { Args: { string: string }; Returns: string }
      check_worker_is_up: { Args: never; Returns: undefined }
      http_collect_response: {
        Args: { async?: boolean; request_id: number }
        Returns: Database["net"]["CompositeTypes"]["http_response_result"]
        SetofOptions: {
          from: "*"
          to: "http_response_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete: {
        Args: {
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      http_get: {
        Args: {
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      http_post: {
        Args: {
          body?: Json
          headers?: Json
          params?: Json
          timeout_milliseconds?: number
          url: string
        }
        Returns: number
      }
      worker_restart: { Args: never; Returns: boolean }
    }
    Enums: {
      request_status: "PENDING" | "SUCCESS" | "ERROR"
    }
    CompositeTypes: {
      http_response: {
        status_code: number | null
        headers: Json | null
        body: string | null
      }
      http_response_result: {
        status: Database["net"]["Enums"]["request_status"] | null
        message: string | null
        response: Database["net"]["CompositeTypes"]["http_response"] | null
      }
    }
  }
  pgbouncer: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_auth: {
        Args: { p_usename: string }
        Returns: {
          password: string
          username: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          endpoint_id: string | null
          id: string
          ip_address: string | null
          organization_id: string
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          endpoint_id?: string | null
          id?: string
          ip_address?: string | null
          organization_id: string
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          endpoint_id?: string | null
          id?: string
          ip_address?: string | null
          organization_id?: string
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_commands: {
        Row: {
          command_type: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          dispatched_at: string | null
          endpoint_id: string
          error_message: string | null
          expires_at: string
          id: string
          incident_id: string | null
          issued_at: string
          issued_by: string | null
          organization_id: string
          params: Json
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          command_type: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          endpoint_id: string
          error_message?: string | null
          expires_at?: string
          id?: string
          incident_id?: string | null
          issued_at?: string
          issued_by?: string | null
          organization_id: string
          params?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          command_type?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          endpoint_id?: string
          error_message?: string | null
          expires_at?: string
          id?: string
          incident_id?: string | null
          issued_at?: string
          issued_by?: string | null
          organization_id?: string
          params?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_commands_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commands_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commands_incident_id_fkey"
            columns: ["incident_id"]
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_commands_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "agent_commands_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_update_log: {
        Row: {
          bytes_downloaded: number | null
          channel: string
          completed_at: string | null
          created_at: string
          detected_at: string
          download_sha256: string | null
          download_url: string | null
          duration_ms: number | null
          endpoint_id: string
          error_message: string | null
          from_version: string | null
          id: string
          organization_id: string
          status: string
          to_version: string
          trigger: string
        }
        Insert: {
          bytes_downloaded?: number | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          detected_at?: string
          download_sha256?: string | null
          download_url?: string | null
          duration_ms?: number | null
          endpoint_id: string
          error_message?: string | null
          from_version?: string | null
          id?: string
          organization_id: string
          status?: string
          to_version: string
          trigger?: string
        }
        Update: {
          bytes_downloaded?: number | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          detected_at?: string
          download_sha256?: string | null
          download_url?: string | null
          duration_ms?: number | null
          endpoint_id?: string
          error_message?: string | null
          from_version?: string | null
          id?: string
          organization_id?: string
          status?: string
          to_version?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_update_log_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_update_log_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_update_log_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "agent_update_log_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_versions: {
        Row: {
          channel: string
          download_url: string
          ed25519_sig: string
          is_active: boolean
          min_os_version: string | null
          published_at: string
          published_by: string | null
          release_notes: string | null
          runtime: string
          sha256: string
          version: string
        }
        Insert: {
          channel?: string
          download_url: string
          ed25519_sig: string
          is_active?: boolean
          min_os_version?: string | null
          published_at?: string
          published_by?: string | null
          release_notes?: string | null
          runtime: string
          sha256: string
          version: string
        }
        Update: {
          channel?: string
          download_url?: string
          ed25519_sig?: string
          is_active?: boolean
          min_os_version?: string | null
          published_at?: string
          published_by?: string | null
          release_notes?: string | null
          runtime?: string
          sha256?: string
          version?: string
        }
        Relationships: []
      }
      ai_investigations: {
        Row: {
          affected_assets: Json
          alert_id: string
          attack_chain_analysis: string | null
          completed_at: string | null
          completion_tokens: number | null
          cost_cents: number
          created_at: string
          customer_notified_at: string | null
          customer_report_markdown: string | null
          error_message: string | null
          id: string
          incident_summary: string | null
          latency_ms: number | null
          mitre_tags: string[]
          model: string | null
          organization_id: string
          prompt_tokens: number | null
          raw_response: Json | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          status: string
          suggested_containment: Json
          suggested_eradication: Json
          timeline: Json
          triage_decision_id: string | null
        }
        Insert: {
          affected_assets?: Json
          alert_id: string
          attack_chain_analysis?: string | null
          completed_at?: string | null
          completion_tokens?: number | null
          cost_cents?: number
          created_at?: string
          customer_notified_at?: string | null
          customer_report_markdown?: string | null
          error_message?: string | null
          id?: string
          incident_summary?: string | null
          latency_ms?: number | null
          mitre_tags?: string[]
          model?: string | null
          organization_id: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          suggested_containment?: Json
          suggested_eradication?: Json
          timeline?: Json
          triage_decision_id?: string | null
        }
        Update: {
          affected_assets?: Json
          alert_id?: string
          attack_chain_analysis?: string | null
          completed_at?: string | null
          completion_tokens?: number | null
          cost_cents?: number
          created_at?: string
          customer_notified_at?: string | null
          customer_report_markdown?: string | null
          error_message?: string | null
          id?: string
          incident_summary?: string | null
          latency_ms?: number | null
          mitre_tags?: string[]
          model?: string | null
          organization_id?: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          suggested_containment?: Json
          suggested_eradication?: Json
          timeline?: Json
          triage_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_investigations_alert_id_fkey"
            columns: ["alert_id"]
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_investigations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_investigations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_investigations_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_investigations_triage_decision_id_fkey"
            columns: ["triage_decision_id"]
            referencedRelation: "ai_triage_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_triage_decisions: {
        Row: {
          alert_id: string
          auto_closed: boolean
          completed_at: string | null
          completion_tokens: number | null
          confidence: number | null
          cost_cents: number
          created_at: string
          error_message: string | null
          escalated_to_investigation: boolean
          id: string
          key_indicators: Json
          latency_ms: number | null
          mitre_tags: string[]
          model: string | null
          organization_id: string
          prompt_tokens: number | null
          raw_response: Json | null
          reasoning_steps: Json
          recommended_action: string | null
          recommended_command: string | null
          review_action: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          status: string
          summary: string | null
          verdict: string | null
        }
        Insert: {
          alert_id: string
          auto_closed?: boolean
          completed_at?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          cost_cents?: number
          created_at?: string
          error_message?: string | null
          escalated_to_investigation?: boolean
          id?: string
          key_indicators?: Json
          latency_ms?: number | null
          mitre_tags?: string[]
          model?: string | null
          organization_id: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          reasoning_steps?: Json
          recommended_action?: string | null
          recommended_command?: string | null
          review_action?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          summary?: string | null
          verdict?: string | null
        }
        Update: {
          alert_id?: string
          auto_closed?: boolean
          completed_at?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          cost_cents?: number
          created_at?: string
          error_message?: string | null
          escalated_to_investigation?: boolean
          id?: string
          key_indicators?: Json
          latency_ms?: number | null
          mitre_tags?: string[]
          model?: string | null
          organization_id?: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          reasoning_steps?: Json
          recommended_action?: string | null
          recommended_command?: string | null
          review_action?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          summary?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_triage_decisions_alert_id_fkey"
            columns: ["alert_id"]
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_triage_decisions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ai_triage_decisions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_triage_decisions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          delivered_to: string[] | null
          endpoint_id: string | null
          id: string
          message: string
          notification_error: string | null
          notified_at: string | null
          organization_id: string
          severity: string
          title: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          delivered_to?: string[] | null
          endpoint_id?: string | null
          id?: string
          message: string
          notification_error?: string | null
          notified_at?: string | null
          organization_id: string
          severity?: string
          title: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          delivered_to?: string[] | null
          endpoint_id?: string | null
          id?: string
          message?: string
          notification_error?: string | null
          notified_at?: string | null
          organization_id?: string
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "alerts_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_audit_logs: {
        Row: {
          action: string
          command_line: string | null
          created_at: string
          endpoint_id: string
          event_time: string
          file_name: string | null
          file_path: string | null
          file_version: string | null
          id: string
          organization_id: string
          parent_path: string | null
          process_id: number | null
          product_name: string | null
          publisher: string | null
          rule_id: string | null
          sha256: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          command_line?: string | null
          created_at?: string
          endpoint_id: string
          event_time?: string
          file_name?: string | null
          file_path?: string | null
          file_version?: string | null
          id?: string
          organization_id: string
          parent_path?: string | null
          process_id?: number | null
          product_name?: string | null
          publisher?: string | null
          rule_id?: string | null
          sha256?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          command_line?: string | null
          created_at?: string
          endpoint_id?: string
          event_time?: string
          file_name?: string | null
          file_path?: string | null
          file_version?: string | null
          id?: string
          organization_id?: string
          parent_path?: string | null
          process_id?: number | null
          product_name?: string | null
          publisher?: string | null
          rule_id?: string | null
          sha256?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_audit_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_audit_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "app_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_audit_logs_rule_id_fkey"
            columns: ["rule_id"]
            referencedRelation: "app_whitelist_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      app_whitelist_rules: {
        Row: {
          app_name: string | null
          created_at: string
          created_by: string | null
          enabled: boolean
          endpoint_id: string
          file_path: string | null
          id: string
          match_type: string
          match_value: string
          organization_id: string
          publisher: string | null
          sha256: string | null
        }
        Insert: {
          app_name?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          endpoint_id: string
          file_path?: string | null
          id?: string
          match_type: string
          match_value: string
          organization_id: string
          publisher?: string | null
          sha256?: string | null
        }
        Update: {
          app_name?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          endpoint_id?: string
          file_path?: string | null
          id?: string
          match_type?: string
          match_value?: string
          organization_id?: string
          publisher?: string | null
          sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_whitelist_rules_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_whitelist_rules_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_whitelist_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "app_whitelist_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_whitelist_state: {
        Row: {
          audit_started_at: string | null
          endpoint_id: string
          enforce_started_at: string | null
          mode: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          audit_started_at?: string | null
          endpoint_id: string
          enforce_started_at?: string | null
          mode?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          audit_started_at?: string | null
          endpoint_id?: string
          enforce_started_at?: string | null
          mode?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_whitelist_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_whitelist_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_whitelist_state_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "app_whitelist_state_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_reports: {
        Row: {
          created_at: string
          delivered_to: string[] | null
          error_message: string | null
          generated_at: string | null
          id: string
          kind: string
          last_send_error: string | null
          organization_id: string
          pdf_storage_path: string | null
          period_end: string
          period_start: string
          sent_at: string | null
          site_id: string | null
          status: string
          storage_path: string | null
          summary: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivered_to?: string[] | null
          error_message?: string | null
          generated_at?: string | null
          id?: string
          kind: string
          last_send_error?: string | null
          organization_id: string
          pdf_storage_path?: string | null
          period_end: string
          period_start: string
          sent_at?: string | null
          site_id?: string | null
          status?: string
          storage_path?: string | null
          summary?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivered_to?: string[] | null
          error_message?: string | null
          generated_at?: string | null
          id?: string
          kind?: string
          last_send_error?: string | null
          organization_id?: string
          pdf_storage_path?: string | null
          period_end?: string
          period_start?: string
          sent_at?: string | null
          site_id?: string | null
          status?: string
          storage_path?: string | null
          summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_reports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "customer_reports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reports_site_id_fkey"
            columns: ["site_id"]
            referencedRelation: "monitored_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      cve_lookup_cache: {
        Row: {
          checked_at: string
          cves: Json
          model: string | null
          software_name: string
          software_version: string
        }
        Insert: {
          checked_at?: string
          cves?: Json
          model?: string | null
          software_name: string
          software_version?: string
        }
        Update: {
          checked_at?: string
          cves?: Json
          model?: string | null
          software_name?: string
          software_version?: string
        }
        Relationships: []
      }
      defender_policies: {
        Row: {
          archive_scanning: boolean
          asr_advanced_ransomware_protection: Database["public"]["Enums"]["asr_action"]
          asr_block_adobe_child_process: Database["public"]["Enums"]["asr_action"]
          asr_block_credential_stealing: Database["public"]["Enums"]["asr_action"]
          asr_block_email_executable: Database["public"]["Enums"]["asr_action"]
          asr_block_js_vbs_executable: Database["public"]["Enums"]["asr_action"]
          asr_block_obfuscated_scripts: Database["public"]["Enums"]["asr_action"]
          asr_block_office_child_process: Database["public"]["Enums"]["asr_action"]
          asr_block_office_code_injection: Database["public"]["Enums"]["asr_action"]
          asr_block_office_comms_child_process: Database["public"]["Enums"]["asr_action"]
          asr_block_office_executable_content: Database["public"]["Enums"]["asr_action"]
          asr_block_office_macro_win32: Database["public"]["Enums"]["asr_action"]
          asr_block_psexec_wmi: Database["public"]["Enums"]["asr_action"]
          asr_block_untrusted_executables: Database["public"]["Enums"]["asr_action"]
          asr_block_usb_untrusted: Database["public"]["Enums"]["asr_action"]
          asr_block_vulnerable_drivers: Database["public"]["Enums"]["asr_action"]
          asr_block_wmi_persistence: Database["public"]["Enums"]["asr_action"]
          behavior_monitoring: boolean
          block_at_first_seen: boolean
          check_signatures_before_scan: boolean
          cloud_block_level: string
          cloud_delivered_protection: boolean
          cloud_extended_timeout: number
          controlled_folder_access: boolean
          created_at: string
          created_by: string | null
          description: string | null
          email_scanning: boolean
          exclusion_extensions: string[] | null
          exclusion_paths: string[] | null
          exclusion_processes: string[] | null
          exploit_protection_enabled: boolean
          id: string
          ioav_protection: boolean
          is_default: boolean
          maps_reporting: string
          name: string
          network_protection: boolean
          organization_id: string
          pua_protection: boolean
          realtime_monitoring: boolean
          removable_drive_scanning: boolean
          sample_submission: string
          script_scanning: boolean
          signature_update_interval: number
          updated_at: string
        }
        Insert: {
          archive_scanning?: boolean
          asr_advanced_ransomware_protection?: Database["public"]["Enums"]["asr_action"]
          asr_block_adobe_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_credential_stealing?: Database["public"]["Enums"]["asr_action"]
          asr_block_email_executable?: Database["public"]["Enums"]["asr_action"]
          asr_block_js_vbs_executable?: Database["public"]["Enums"]["asr_action"]
          asr_block_obfuscated_scripts?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_code_injection?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_comms_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_executable_content?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_macro_win32?: Database["public"]["Enums"]["asr_action"]
          asr_block_psexec_wmi?: Database["public"]["Enums"]["asr_action"]
          asr_block_untrusted_executables?: Database["public"]["Enums"]["asr_action"]
          asr_block_usb_untrusted?: Database["public"]["Enums"]["asr_action"]
          asr_block_vulnerable_drivers?: Database["public"]["Enums"]["asr_action"]
          asr_block_wmi_persistence?: Database["public"]["Enums"]["asr_action"]
          behavior_monitoring?: boolean
          block_at_first_seen?: boolean
          check_signatures_before_scan?: boolean
          cloud_block_level?: string
          cloud_delivered_protection?: boolean
          cloud_extended_timeout?: number
          controlled_folder_access?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          email_scanning?: boolean
          exclusion_extensions?: string[] | null
          exclusion_paths?: string[] | null
          exclusion_processes?: string[] | null
          exploit_protection_enabled?: boolean
          id?: string
          ioav_protection?: boolean
          is_default?: boolean
          maps_reporting?: string
          name: string
          network_protection?: boolean
          organization_id: string
          pua_protection?: boolean
          realtime_monitoring?: boolean
          removable_drive_scanning?: boolean
          sample_submission?: string
          script_scanning?: boolean
          signature_update_interval?: number
          updated_at?: string
        }
        Update: {
          archive_scanning?: boolean
          asr_advanced_ransomware_protection?: Database["public"]["Enums"]["asr_action"]
          asr_block_adobe_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_credential_stealing?: Database["public"]["Enums"]["asr_action"]
          asr_block_email_executable?: Database["public"]["Enums"]["asr_action"]
          asr_block_js_vbs_executable?: Database["public"]["Enums"]["asr_action"]
          asr_block_obfuscated_scripts?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_code_injection?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_comms_child_process?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_executable_content?: Database["public"]["Enums"]["asr_action"]
          asr_block_office_macro_win32?: Database["public"]["Enums"]["asr_action"]
          asr_block_psexec_wmi?: Database["public"]["Enums"]["asr_action"]
          asr_block_untrusted_executables?: Database["public"]["Enums"]["asr_action"]
          asr_block_usb_untrusted?: Database["public"]["Enums"]["asr_action"]
          asr_block_vulnerable_drivers?: Database["public"]["Enums"]["asr_action"]
          asr_block_wmi_persistence?: Database["public"]["Enums"]["asr_action"]
          behavior_monitoring?: boolean
          block_at_first_seen?: boolean
          check_signatures_before_scan?: boolean
          cloud_block_level?: string
          cloud_delivered_protection?: boolean
          cloud_extended_timeout?: number
          controlled_folder_access?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          email_scanning?: boolean
          exclusion_extensions?: string[] | null
          exclusion_paths?: string[] | null
          exclusion_processes?: string[] | null
          exploit_protection_enabled?: boolean
          id?: string
          ioav_protection?: boolean
          is_default?: boolean
          maps_reporting?: string
          name?: string
          network_protection?: boolean
          organization_id?: string
          pua_protection?: boolean
          realtime_monitoring?: boolean
          removable_drive_scanning?: boolean
          sample_submission?: string
          script_scanning?: boolean
          signature_update_interval?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "defender_policies_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "defender_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "defender_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dns_internal_scopes: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          forwarders: string[]
          id: string
          policy_id: string
          suffix: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          forwarders: string[]
          id?: string
          policy_id: string
          suffix: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          forwarders?: string[]
          id?: string
          policy_id?: string
          suffix?: string
        }
        Relationships: [
          {
            foreignKeyName: "dns_internal_scopes_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "dns_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      dns_policies: {
        Row: {
          block_adult: boolean
          block_gambling: boolean
          block_malware: boolean
          block_phishing: boolean
          block_social: boolean
          created_at: string
          created_by: string | null
          custom_allowlist: string[]
          custom_blocklist: string[]
          description: string | null
          disable_browser_doh: boolean
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
          upstream_doh_uri: string | null
          upstream_provider: string | null
          upstream_servers: string[] | null
        }
        Insert: {
          block_adult?: boolean
          block_gambling?: boolean
          block_malware?: boolean
          block_phishing?: boolean
          block_social?: boolean
          created_at?: string
          created_by?: string | null
          custom_allowlist?: string[]
          custom_blocklist?: string[]
          description?: string | null
          disable_browser_doh?: boolean
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
          upstream_doh_uri?: string | null
          upstream_provider?: string | null
          upstream_servers?: string[] | null
        }
        Update: {
          block_adult?: boolean
          block_gambling?: boolean
          block_malware?: boolean
          block_phishing?: boolean
          block_social?: boolean
          created_at?: string
          created_by?: string | null
          custom_allowlist?: string[]
          custom_blocklist?: string[]
          description?: string | null
          disable_browser_doh?: boolean
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          upstream_doh_uri?: string | null
          upstream_provider?: string | null
          upstream_servers?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "dns_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dns_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dns_policy_assignments: {
        Row: {
          created_at: string
          endpoint_group_id: string | null
          endpoint_id: string | null
          id: string
          policy_id: string
        }
        Insert: {
          created_at?: string
          endpoint_group_id?: string | null
          endpoint_id?: string | null
          id?: string
          policy_id: string
        }
        Update: {
          created_at?: string
          endpoint_group_id?: string | null
          endpoint_id?: string | null
          id?: string
          policy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dns_policy_assignments_endpoint_group_id_fkey"
            columns: ["endpoint_group_id"]
            referencedRelation: "endpoint_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dns_policy_assignments_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dns_policy_assignments_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dns_policy_assignments_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "dns_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      dns_query_logs: {
        Row: {
          action: string
          block_reason: string | null
          client_ip: string | null
          endpoint_id: string | null
          id: string
          latency_ms: number | null
          organization_id: string
          policy_id: string | null
          query_name: string
          query_time: string
          query_type: string | null
          response_code: string | null
          upstream_used: string | null
        }
        Insert: {
          action: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id: string
          policy_id?: string | null
          query_name: string
          query_time: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Update: {
          action?: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id?: string
          policy_id?: string | null
          query_name?: string
          query_time?: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Relationships: []
      }
      dns_query_logs_2026_05: {
        Row: {
          action: string
          block_reason: string | null
          client_ip: string | null
          endpoint_id: string | null
          id: string
          latency_ms: number | null
          organization_id: string
          policy_id: string | null
          query_name: string
          query_time: string
          query_type: string | null
          response_code: string | null
          upstream_used: string | null
        }
        Insert: {
          action: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id: string
          policy_id?: string | null
          query_name: string
          query_time: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Update: {
          action?: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id?: string
          policy_id?: string | null
          query_name?: string
          query_time?: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Relationships: []
      }
      dns_query_logs_2026_06: {
        Row: {
          action: string
          block_reason: string | null
          client_ip: string | null
          endpoint_id: string | null
          id: string
          latency_ms: number | null
          organization_id: string
          policy_id: string | null
          query_name: string
          query_time: string
          query_type: string | null
          response_code: string | null
          upstream_used: string | null
        }
        Insert: {
          action: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id: string
          policy_id?: string | null
          query_name: string
          query_time: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Update: {
          action?: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id?: string
          policy_id?: string | null
          query_name?: string
          query_time?: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Relationships: []
      }
      dns_query_logs_2026_07: {
        Row: {
          action: string
          block_reason: string | null
          client_ip: string | null
          endpoint_id: string | null
          id: string
          latency_ms: number | null
          organization_id: string
          policy_id: string | null
          query_name: string
          query_time: string
          query_type: string | null
          response_code: string | null
          upstream_used: string | null
        }
        Insert: {
          action: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id: string
          policy_id?: string | null
          query_name: string
          query_time: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Update: {
          action?: string
          block_reason?: string | null
          client_ip?: string | null
          endpoint_id?: string | null
          id?: string
          latency_ms?: number | null
          organization_id?: string
          policy_id?: string | null
          query_name?: string
          query_time?: string
          query_type?: string | null
          response_code?: string | null
          upstream_used?: string | null
        }
        Relationships: []
      }
      endpoint_app_control_state: {
        Row: {
          apply_failure_count: number
          assigned_at: string
          audit_until: string
          current_mode: string
          endpoint_id: string
          last_applied_at: string | null
          last_applied_version: string | null
          last_apply_error: string | null
          rule_set_id: string
        }
        Insert: {
          apply_failure_count?: number
          assigned_at?: string
          audit_until: string
          current_mode?: string
          endpoint_id: string
          last_applied_at?: string | null
          last_applied_version?: string | null
          last_apply_error?: string | null
          rule_set_id: string
        }
        Update: {
          apply_failure_count?: number
          assigned_at?: string
          audit_until?: string
          current_mode?: string
          endpoint_id?: string
          last_applied_at?: string | null
          last_applied_version?: string | null
          last_apply_error?: string | null
          rule_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_app_control_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_app_control_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_app_control_state_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_commands: {
        Row: {
          command_type: string
          completed_at: string | null
          created_at: string
          endpoint_id: string
          id: string
          issued_at: string
          issued_by: string | null
          organization_id: string
          parameters: Json | null
          result: Json | null
          sent_at: string | null
          status: string
        }
        Insert: {
          command_type: string
          completed_at?: string | null
          created_at?: string
          endpoint_id: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id: string
          parameters?: Json | null
          result?: Json | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          command_type?: string
          completed_at?: string | null
          created_at?: string
          endpoint_id?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          organization_id?: string
          parameters?: Json | null
          result?: Json | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_commands_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_commands_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_commands_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_commands_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_event_logs: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_event_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_event_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_event_logs_2026_03: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: []
      }
      endpoint_event_logs_2026_04: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: []
      }
      endpoint_event_logs_2026_05: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: []
      }
      endpoint_event_logs_2026_06: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: []
      }
      endpoint_event_logs_2026_07: {
        Row: {
          created_at: string
          endpoint_id: string
          event_id: number
          event_time: string
          id: string
          level: string
          log_source: string
          message: string
          provider_name: string | null
          raw_data: Json | null
          task_category: string | null
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_id: number
          event_time: string
          id?: string
          level: string
          log_source: string
          message: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_id?: number
          event_time?: string
          id?: string
          level?: string
          log_source?: string
          message?: string
          provider_name?: string | null
          raw_data?: Json | null
          task_category?: string | null
        }
        Relationships: []
      }
      endpoint_group_memberships: {
        Row: {
          created_at: string
          endpoint_id: string
          group_id: string
          id: string
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          group_id: string
          id?: string
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_group_memberships_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_group_memberships_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_group_memberships_group_id_fkey"
            columns: ["group_id"]
            referencedRelation: "endpoint_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_groups: {
        Row: {
          created_at: string
          created_by: string | null
          defender_policy_id: string | null
          description: string | null
          gpo_policy_id: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          uac_policy_id: string | null
          updated_at: string
          wdac_policy_id: string | null
          windows_update_policy_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defender_policy_id?: string | null
          description?: string | null
          gpo_policy_id?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          uac_policy_id?: string | null
          updated_at?: string
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defender_policy_id?: string | null
          description?: string | null
          gpo_policy_id?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          uac_policy_id?: string | null
          updated_at?: string
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_groups_defender_policy_id_fkey"
            columns: ["defender_policy_id"]
            referencedRelation: "defender_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_groups_gpo_policy_id_fkey"
            columns: ["gpo_policy_id"]
            referencedRelation: "gpo_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_groups_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_groups_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_groups_uac_policy_id_fkey"
            columns: ["uac_policy_id"]
            referencedRelation: "uac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_groups_wdac_policy_id_fkey"
            columns: ["wdac_policy_id"]
            referencedRelation: "wdac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_groups_windows_update_policy_id_fkey"
            columns: ["windows_update_policy_id"]
            referencedRelation: "windows_update_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_hardening_status: {
        Row: {
          compliance_score: number | null
          created_at: string
          endpoint_id: string
          esu_estimated_annual_cost: number | null
          failed_checks: number | null
          findings: Json | null
          hardening_profile_id: string | null
          id: string
          is_legacy: boolean
          last_assessed_at: string | null
          organization_id: string
          os_category: string | null
          os_eol_date: string | null
          passed_checks: number | null
          total_checks: number | null
          updated_at: string
        }
        Insert: {
          compliance_score?: number | null
          created_at?: string
          endpoint_id: string
          esu_estimated_annual_cost?: number | null
          failed_checks?: number | null
          findings?: Json | null
          hardening_profile_id?: string | null
          id?: string
          is_legacy?: boolean
          last_assessed_at?: string | null
          organization_id: string
          os_category?: string | null
          os_eol_date?: string | null
          passed_checks?: number | null
          total_checks?: number | null
          updated_at?: string
        }
        Update: {
          compliance_score?: number | null
          created_at?: string
          endpoint_id?: string
          esu_estimated_annual_cost?: number | null
          failed_checks?: number | null
          findings?: Json | null
          hardening_profile_id?: string | null
          id?: string
          is_legacy?: boolean
          last_assessed_at?: string | null
          organization_id?: string
          os_category?: string | null
          os_eol_date?: string | null
          passed_checks?: number | null
          total_checks?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_hardening_status_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_hardening_status_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_hardening_status_hardening_profile_id_fkey"
            columns: ["hardening_profile_id"]
            referencedRelation: "hardening_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_hardening_status_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_hardening_status_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_logs: {
        Row: {
          created_at: string
          details: Json | null
          endpoint_id: string
          id: string
          log_type: string
          message: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          endpoint_id: string
          id?: string
          log_type: string
          message: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          endpoint_id?: string
          id?: string
          log_type?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_microseg_state: {
        Row: {
          direction: string
          endpoint_id: string
          enforce_started_at: string | null
          observation_started_at: string | null
          organization_id: string
          state: string
          updated_at: string
        }
        Insert: {
          direction?: string
          endpoint_id: string
          enforce_started_at?: string | null
          observation_started_at?: string | null
          organization_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          direction?: string
          endpoint_id?: string
          enforce_started_at?: string | null
          observation_started_at?: string | null
          organization_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_microseg_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_microseg_state_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_microseg_state_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_microseg_state_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_persistence_snapshots: {
        Row: {
          collected_at: string
          endpoint_id: string
          id: string
          organization_id: string
          payload: Json
          run_key_count: number
          service_count: number
          snapshot_hash: string
          task_count: number
        }
        Insert: {
          collected_at?: string
          endpoint_id: string
          id?: string
          organization_id: string
          payload: Json
          run_key_count?: number
          service_count?: number
          snapshot_hash: string
          task_count?: number
        }
        Update: {
          collected_at?: string
          endpoint_id?: string
          id?: string
          organization_id?: string
          payload?: Json
          run_key_count?: number
          service_count?: number
          snapshot_hash?: string
          task_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_persistence_snapshots_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_persistence_snapshots_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_persistence_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_persistence_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_rule_set_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          endpoint_id: string
          id: string
          priority: number
          rule_set_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          endpoint_id: string
          id?: string
          priority?: number
          rule_set_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          endpoint_id?: string
          id?: string
          priority?: number
          rule_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_rule_set_assignments_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_rule_set_assignments_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_rule_set_assignments_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_software_inventory: {
        Row: {
          architecture: string | null
          created_at: string
          endpoint_id: string
          id: string
          install_date: string | null
          organization_id: string
          publisher: string | null
          software_name: string
          software_version: string | null
          updated_at: string
        }
        Insert: {
          architecture?: string | null
          created_at?: string
          endpoint_id: string
          id?: string
          install_date?: string | null
          organization_id: string
          publisher?: string | null
          software_name: string
          software_version?: string | null
          updated_at?: string
        }
        Update: {
          architecture?: string | null
          created_at?: string
          endpoint_id?: string
          id?: string
          install_date?: string | null
          organization_id?: string
          publisher?: string | null
          software_name?: string
          software_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_software_inventory_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_software_inventory_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_software_inventory_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoint_software_inventory_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_status: {
        Row: {
          am_running_mode: string | null
          antispyware_enabled: boolean | null
          antispyware_signature_age: number | null
          antivirus_enabled: boolean | null
          antivirus_signature_age: number | null
          antivirus_signature_version: string | null
          behavior_monitor_enabled: boolean | null
          collected_at: string
          computer_state: number | null
          endpoint_id: string
          full_scan_age: number | null
          full_scan_end_time: string | null
          id: string
          ioav_protection_enabled: boolean | null
          nis_enabled: boolean | null
          nis_signature_version: string | null
          on_access_protection_enabled: boolean | null
          quick_scan_age: number | null
          quick_scan_end_time: string | null
          raw_status: Json | null
          realtime_protection_enabled: boolean | null
          tamper_protection_source: string | null
          uac_consent_prompt_admin: number | null
          uac_consent_prompt_user: number | null
          uac_detect_installations: boolean | null
          uac_enabled: boolean | null
          uac_filter_administrator_token: boolean | null
          uac_prompt_on_secure_desktop: boolean | null
          uac_validate_admin_signatures: boolean | null
          wu_active_hours_end: number | null
          wu_active_hours_start: number | null
          wu_auto_update_mode: number | null
          wu_feature_update_deferral: number | null
          wu_last_install_date: string | null
          wu_pause_feature_updates: boolean | null
          wu_pause_quality_updates: boolean | null
          wu_pending_updates_count: number | null
          wu_quality_update_deferral: number | null
          wu_restart_pending: boolean | null
        }
        Insert: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Update: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id?: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_status_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_status_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoint_status_2026_05: {
        Row: {
          am_running_mode: string | null
          antispyware_enabled: boolean | null
          antispyware_signature_age: number | null
          antivirus_enabled: boolean | null
          antivirus_signature_age: number | null
          antivirus_signature_version: string | null
          behavior_monitor_enabled: boolean | null
          collected_at: string
          computer_state: number | null
          endpoint_id: string
          full_scan_age: number | null
          full_scan_end_time: string | null
          id: string
          ioav_protection_enabled: boolean | null
          nis_enabled: boolean | null
          nis_signature_version: string | null
          on_access_protection_enabled: boolean | null
          quick_scan_age: number | null
          quick_scan_end_time: string | null
          raw_status: Json | null
          realtime_protection_enabled: boolean | null
          tamper_protection_source: string | null
          uac_consent_prompt_admin: number | null
          uac_consent_prompt_user: number | null
          uac_detect_installations: boolean | null
          uac_enabled: boolean | null
          uac_filter_administrator_token: boolean | null
          uac_prompt_on_secure_desktop: boolean | null
          uac_validate_admin_signatures: boolean | null
          wu_active_hours_end: number | null
          wu_active_hours_start: number | null
          wu_auto_update_mode: number | null
          wu_feature_update_deferral: number | null
          wu_last_install_date: string | null
          wu_pause_feature_updates: boolean | null
          wu_pause_quality_updates: boolean | null
          wu_pending_updates_count: number | null
          wu_quality_update_deferral: number | null
          wu_restart_pending: boolean | null
        }
        Insert: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Update: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id?: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Relationships: []
      }
      endpoint_status_2026_06: {
        Row: {
          am_running_mode: string | null
          antispyware_enabled: boolean | null
          antispyware_signature_age: number | null
          antivirus_enabled: boolean | null
          antivirus_signature_age: number | null
          antivirus_signature_version: string | null
          behavior_monitor_enabled: boolean | null
          collected_at: string
          computer_state: number | null
          endpoint_id: string
          full_scan_age: number | null
          full_scan_end_time: string | null
          id: string
          ioav_protection_enabled: boolean | null
          nis_enabled: boolean | null
          nis_signature_version: string | null
          on_access_protection_enabled: boolean | null
          quick_scan_age: number | null
          quick_scan_end_time: string | null
          raw_status: Json | null
          realtime_protection_enabled: boolean | null
          tamper_protection_source: string | null
          uac_consent_prompt_admin: number | null
          uac_consent_prompt_user: number | null
          uac_detect_installations: boolean | null
          uac_enabled: boolean | null
          uac_filter_administrator_token: boolean | null
          uac_prompt_on_secure_desktop: boolean | null
          uac_validate_admin_signatures: boolean | null
          wu_active_hours_end: number | null
          wu_active_hours_start: number | null
          wu_auto_update_mode: number | null
          wu_feature_update_deferral: number | null
          wu_last_install_date: string | null
          wu_pause_feature_updates: boolean | null
          wu_pause_quality_updates: boolean | null
          wu_pending_updates_count: number | null
          wu_quality_update_deferral: number | null
          wu_restart_pending: boolean | null
        }
        Insert: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Update: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id?: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Relationships: []
      }
      endpoint_status_2026_07: {
        Row: {
          am_running_mode: string | null
          antispyware_enabled: boolean | null
          antispyware_signature_age: number | null
          antivirus_enabled: boolean | null
          antivirus_signature_age: number | null
          antivirus_signature_version: string | null
          behavior_monitor_enabled: boolean | null
          collected_at: string
          computer_state: number | null
          endpoint_id: string
          full_scan_age: number | null
          full_scan_end_time: string | null
          id: string
          ioav_protection_enabled: boolean | null
          nis_enabled: boolean | null
          nis_signature_version: string | null
          on_access_protection_enabled: boolean | null
          quick_scan_age: number | null
          quick_scan_end_time: string | null
          raw_status: Json | null
          realtime_protection_enabled: boolean | null
          tamper_protection_source: string | null
          uac_consent_prompt_admin: number | null
          uac_consent_prompt_user: number | null
          uac_detect_installations: boolean | null
          uac_enabled: boolean | null
          uac_filter_administrator_token: boolean | null
          uac_prompt_on_secure_desktop: boolean | null
          uac_validate_admin_signatures: boolean | null
          wu_active_hours_end: number | null
          wu_active_hours_start: number | null
          wu_auto_update_mode: number | null
          wu_feature_update_deferral: number | null
          wu_last_install_date: string | null
          wu_pause_feature_updates: boolean | null
          wu_pause_quality_updates: boolean | null
          wu_pending_updates_count: number | null
          wu_quality_update_deferral: number | null
          wu_restart_pending: boolean | null
        }
        Insert: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Update: {
          am_running_mode?: string | null
          antispyware_enabled?: boolean | null
          antispyware_signature_age?: number | null
          antivirus_enabled?: boolean | null
          antivirus_signature_age?: number | null
          antivirus_signature_version?: string | null
          behavior_monitor_enabled?: boolean | null
          collected_at?: string
          computer_state?: number | null
          endpoint_id?: string
          full_scan_age?: number | null
          full_scan_end_time?: string | null
          id?: string
          ioav_protection_enabled?: boolean | null
          nis_enabled?: boolean | null
          nis_signature_version?: string | null
          on_access_protection_enabled?: boolean | null
          quick_scan_age?: number | null
          quick_scan_end_time?: string | null
          raw_status?: Json | null
          realtime_protection_enabled?: boolean | null
          tamper_protection_source?: string | null
          uac_consent_prompt_admin?: number | null
          uac_consent_prompt_user?: number | null
          uac_detect_installations?: boolean | null
          uac_enabled?: boolean | null
          uac_filter_administrator_token?: boolean | null
          uac_prompt_on_secure_desktop?: boolean | null
          uac_validate_admin_signatures?: boolean | null
          wu_active_hours_end?: number | null
          wu_active_hours_start?: number | null
          wu_auto_update_mode?: number | null
          wu_feature_update_deferral?: number | null
          wu_last_install_date?: string | null
          wu_pause_feature_updates?: boolean | null
          wu_pause_quality_updates?: boolean | null
          wu_pending_updates_count?: number | null
          wu_quality_update_deferral?: number | null
          wu_restart_pending?: boolean | null
        }
        Relationships: []
      }
      endpoint_threats: {
        Row: {
          category: string | null
          created_at: string
          endpoint_id: string
          id: string
          initial_detection_time: string | null
          last_threat_status_change_time: string | null
          manual_resolution_active: boolean
          manual_resolved_at: string | null
          manual_resolved_by: string | null
          raw_data: Json | null
          resources: Json | null
          severity: string
          status: string
          threat_id: string
          threat_name: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          endpoint_id: string
          id?: string
          initial_detection_time?: string | null
          last_threat_status_change_time?: string | null
          manual_resolution_active?: boolean
          manual_resolved_at?: string | null
          manual_resolved_by?: string | null
          raw_data?: Json | null
          resources?: Json | null
          severity: string
          status: string
          threat_id: string
          threat_name: string
        }
        Update: {
          category?: string | null
          created_at?: string
          endpoint_id?: string
          id?: string
          initial_detection_time?: string | null
          last_threat_status_change_time?: string | null
          manual_resolution_active?: boolean
          manual_resolved_at?: string | null
          manual_resolved_by?: string | null
          raw_data?: Json | null
          resources?: Json | null
          severity?: string
          status?: string
          threat_id?: string
          threat_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_threats_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoint_threats_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      endpoints: {
        Row: {
          agent_secret: string | null
          agent_token: string
          agent_version: string | null
          created_at: string
          defender_state: Json | null
          defender_state_updated_at: string | null
          defender_version: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          distro: string | null
          distro_version: string | null
          enrolled_at: string | null
          enrolled_via: string | null
          hostname: string
          id: string
          is_active: boolean
          is_online: boolean
          isolation_mode: string
          kernel_version: string | null
          last_boot_at: string | null
          last_seen_at: string | null
          lsm_status: string | null
          mesh_agent_error: string | null
          mesh_agent_installed_at: string | null
          mesh_agent_state: string
          mesh_node_id: string | null
          organization_id: string
          os_build: string | null
          os_version: string | null
          policy_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          runtime: string | null
          ssh_config_summary: Json | null
          uac_policy_id: string | null
          unattended_upgrades: boolean | null
          update_channel: string
          updated_at: string
          uptime_seconds: number | null
          wdac_policy_id: string | null
          windows_update_policy_id: string | null
        }
        Insert: {
          agent_secret?: string | null
          agent_token: string
          agent_version?: string | null
          created_at?: string
          defender_state?: Json | null
          defender_state_updated_at?: string | null
          defender_version?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          distro?: string | null
          distro_version?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          hostname: string
          id?: string
          is_active?: boolean
          is_online?: boolean
          isolation_mode?: string
          kernel_version?: string | null
          last_boot_at?: string | null
          last_seen_at?: string | null
          lsm_status?: string | null
          mesh_agent_error?: string | null
          mesh_agent_installed_at?: string | null
          mesh_agent_state?: string
          mesh_node_id?: string | null
          organization_id: string
          os_build?: string | null
          os_version?: string | null
          policy_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          runtime?: string | null
          ssh_config_summary?: Json | null
          uac_policy_id?: string | null
          unattended_upgrades?: boolean | null
          update_channel?: string
          updated_at?: string
          uptime_seconds?: number | null
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Update: {
          agent_secret?: string | null
          agent_token?: string
          agent_version?: string | null
          created_at?: string
          defender_state?: Json | null
          defender_state_updated_at?: string | null
          defender_version?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          distro?: string | null
          distro_version?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          hostname?: string
          id?: string
          is_active?: boolean
          is_online?: boolean
          isolation_mode?: string
          kernel_version?: string | null
          last_boot_at?: string | null
          last_seen_at?: string | null
          lsm_status?: string | null
          mesh_agent_error?: string | null
          mesh_agent_installed_at?: string | null
          mesh_agent_state?: string
          mesh_node_id?: string | null
          organization_id?: string
          os_build?: string | null
          os_version?: string | null
          policy_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          runtime?: string | null
          ssh_config_summary?: Json | null
          uac_policy_id?: string | null
          unattended_upgrades?: boolean | null
          update_channel?: string
          updated_at?: string
          uptime_seconds?: number | null
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoints_deleted_by_fkey"
            columns: ["deleted_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_enrolled_via_fkey"
            columns: ["enrolled_via"]
            referencedRelation: "enrollment_tokens"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "endpoints_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoints_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "defender_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_uac_policy_id_fkey"
            columns: ["uac_policy_id"]
            referencedRelation: "uac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_wdac_policy_id_fkey"
            columns: ["wdac_policy_id"]
            referencedRelation: "wdac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_windows_update_policy_id_fkey"
            columns: ["windows_update_policy_id"]
            referencedRelation: "windows_update_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          is_single_use: boolean
          max_uses: number | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          use_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_single_use?: boolean
          max_uses?: number | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          use_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_single_use?: boolean
          max_uses?: number | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_codes_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "enrollment_codes_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_tokens: {
        Row: {
          channel: string
          created_at: string
          created_by: string
          expires_at: string
          hostname_hint: string | null
          max_uses: number
          organization_id: string
          runtime_hint: string | null
          token: string
          use_count: number
          used_at: string | null
          used_by_endpoint: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          created_by: string
          expires_at?: string
          hostname_hint?: string | null
          max_uses?: number
          organization_id: string
          runtime_hint?: string | null
          token: string
          use_count?: number
          used_at?: string | null
          used_by_endpoint?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          hostname_hint?: string | null
          max_uses?: number
          organization_id?: string
          runtime_hint?: string | null
          token?: string
          use_count?: number
          used_at?: string | null
          used_by_endpoint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tokens_used_by_endpoint_fkey"
            columns: ["used_by_endpoint"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tokens_used_by_endpoint_fkey"
            columns: ["used_by_endpoint"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      firewall_audit_logs: {
        Row: {
          created_at: string
          direction: string
          endpoint_id: string
          event_time: string
          id: string
          local_port: number
          organization_id: string
          protocol: string
          remote_address: string
          remote_port: number | null
          rule_id: string | null
          service_name: string
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint_id: string
          event_time: string
          id?: string
          local_port: number
          organization_id: string
          protocol?: string
          remote_address: string
          remote_port?: number | null
          rule_id?: string | null
          service_name: string
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint_id?: string
          event_time?: string
          id?: string
          local_port?: number
          organization_id?: string
          protocol?: string
          remote_address?: string
          remote_port?: number | null
          rule_id?: string | null
          service_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "firewall_audit_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "firewall_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_logs_rule_id_fkey"
            columns: ["rule_id"]
            referencedRelation: "firewall_service_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      firewall_audit_logs_2026_04: {
        Row: {
          created_at: string
          direction: string
          endpoint_id: string
          event_time: string
          id: string
          local_port: number
          organization_id: string
          protocol: string
          remote_address: string
          remote_port: number | null
          rule_id: string | null
          service_name: string
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint_id: string
          event_time: string
          id?: string
          local_port: number
          organization_id: string
          protocol?: string
          remote_address: string
          remote_port?: number | null
          rule_id?: string | null
          service_name: string
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint_id?: string
          event_time?: string
          id?: string
          local_port?: number
          organization_id?: string
          protocol?: string
          remote_address?: string
          remote_port?: number | null
          rule_id?: string | null
          service_name?: string
        }
        Relationships: []
      }
      firewall_audit_logs_2026_05: {
        Row: {
          created_at: string
          direction: string
          endpoint_id: string
          event_time: string
          id: string
          local_port: number
          organization_id: string
          protocol: string
          remote_address: string
          remote_port: number | null
          rule_id: string | null
          service_name: string
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint_id: string
          event_time: string
          id?: string
          local_port: number
          organization_id: string
          protocol?: string
          remote_address: string
          remote_port?: number | null
          rule_id?: string | null
          service_name: string
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint_id?: string
          event_time?: string
          id?: string
          local_port?: number
          organization_id?: string
          protocol?: string
          remote_address?: string
          remote_port?: number | null
          rule_id?: string | null
          service_name?: string
        }
        Relationships: []
      }
      firewall_audit_logs_2026_06: {
        Row: {
          created_at: string
          direction: string
          endpoint_id: string
          event_time: string
          id: string
          local_port: number
          organization_id: string
          protocol: string
          remote_address: string
          remote_port: number | null
          rule_id: string | null
          service_name: string
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint_id: string
          event_time: string
          id?: string
          local_port: number
          organization_id: string
          protocol?: string
          remote_address: string
          remote_port?: number | null
          rule_id?: string | null
          service_name: string
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint_id?: string
          event_time?: string
          id?: string
          local_port?: number
          organization_id?: string
          protocol?: string
          remote_address?: string
          remote_port?: number | null
          rule_id?: string | null
          service_name?: string
        }
        Relationships: []
      }
      firewall_audit_logs_2026_07: {
        Row: {
          created_at: string
          direction: string
          endpoint_id: string
          event_time: string
          id: string
          local_port: number
          organization_id: string
          protocol: string
          remote_address: string
          remote_port: number | null
          rule_id: string | null
          service_name: string
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint_id: string
          event_time: string
          id?: string
          local_port: number
          organization_id: string
          protocol?: string
          remote_address: string
          remote_port?: number | null
          rule_id?: string | null
          service_name: string
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint_id?: string
          event_time?: string
          id?: string
          local_port?: number
          organization_id?: string
          protocol?: string
          remote_address?: string
          remote_port?: number | null
          rule_id?: string | null
          service_name?: string
        }
        Relationships: []
      }
      firewall_audit_sessions: {
        Row: {
          created_at: string
          ends_at: string
          generated_template_id: string | null
          id: string
          organization_id: string
          policy_id: string
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          generated_template_id?: string | null
          id?: string
          organization_id: string
          policy_id: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          generated_template_id?: string | null
          id?: string
          organization_id?: string
          policy_id?: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firewall_audit_sessions_generated_template_id_fkey"
            columns: ["generated_template_id"]
            referencedRelation: "firewall_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "firewall_audit_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_sessions_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "firewall_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_audit_sessions_started_by_fkey"
            columns: ["started_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      firewall_policies: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firewall_policies_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "firewall_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      firewall_service_rules: {
        Row: {
          action: string
          allowed_source_groups: string[] | null
          allowed_source_ips: string[] | null
          audit_started_at: string
          created_at: string
          direction: string
          enabled: boolean
          endpoint_group_id: string
          id: string
          mode: string
          order_priority: number
          policy_id: string
          port: string
          protocol: string
          service_name: string
        }
        Insert: {
          action?: string
          allowed_source_groups?: string[] | null
          allowed_source_ips?: string[] | null
          audit_started_at?: string
          created_at?: string
          direction?: string
          enabled?: boolean
          endpoint_group_id: string
          id?: string
          mode?: string
          order_priority?: number
          policy_id: string
          port: string
          protocol?: string
          service_name: string
        }
        Update: {
          action?: string
          allowed_source_groups?: string[] | null
          allowed_source_ips?: string[] | null
          audit_started_at?: string
          created_at?: string
          direction?: string
          enabled?: boolean
          endpoint_group_id?: string
          id?: string
          mode?: string
          order_priority?: number
          policy_id?: string
          port?: string
          protocol?: string
          service_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "firewall_service_rules_endpoint_group_id_fkey"
            columns: ["endpoint_group_id"]
            referencedRelation: "endpoint_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firewall_service_rules_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "firewall_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      firewall_templates: {
        Row: {
          category: string
          created_at: string
          default_mode: string
          description: string | null
          id: string
          name: string
          rules_json: Json
        }
        Insert: {
          category?: string
          created_at?: string
          default_mode?: string
          description?: string | null
          id?: string
          name: string
          rules_json?: Json
        }
        Update: {
          category?: string
          created_at?: string
          default_mode?: string
          description?: string | null
          id?: string
          name?: string
          rules_json?: Json
        }
        Relationships: []
      }
      gpo_policies: {
        Row: {
          audit_account_logon: string
          audit_account_management: string
          audit_ds_access: string
          audit_logon_events: string
          audit_object_access: string
          audit_policy_change: string
          audit_privilege_use: string
          audit_process_tracking: string
          audit_system_events: string
          created_at: string
          created_by: string | null
          custom_registry_settings: Json
          description: string | null
          devices_restrict_cd_rom: boolean
          devices_restrict_floppy: boolean
          disable_cmd_prompt: boolean
          disable_consumer_features: boolean
          disable_control_panel: boolean
          disable_cortana: boolean
          disable_game_bar: boolean
          disable_ipv6: boolean
          disable_lock_screen_camera: boolean
          disable_onedrive: boolean
          disable_registry_tools: boolean
          disable_run_command: boolean
          disable_store_apps: boolean
          disable_task_manager: boolean
          disable_telemetry: boolean
          disable_wifi_sense: boolean
          enable_windows_firewall_domain: boolean
          enable_windows_firewall_private: boolean
          enable_windows_firewall_public: boolean
          id: string
          interactive_logon_dont_display_last_user: boolean
          interactive_logon_message_text: string
          interactive_logon_message_title: string
          interactive_logon_require_ctrl_alt_del: boolean
          is_default: boolean
          lockout_duration_minutes: number
          lockout_reset_minutes: number
          lockout_threshold: number
          name: string
          network_access_restrict_anonymous: boolean
          network_security_lan_manager_level: number
          network_security_min_session_security_ntlm: boolean
          organization_id: string
          password_complexity_enabled: boolean
          password_history_count: number
          password_max_age_days: number
          password_min_age_days: number
          password_min_length: number
          password_reversible_encryption: boolean
          remote_desktop_enabled: boolean
          remote_desktop_max_sessions: number
          remote_desktop_nla_required: boolean
          require_password_on_wake: boolean
          right_change_system_time: string[]
          right_debug_programs: string[]
          right_deny_local_logon: string[]
          right_deny_network_logon: string[]
          right_deny_remote_desktop_logon: string[]
          right_local_logon: string[]
          right_network_logon: string[]
          right_remote_desktop_logon: string[]
          right_shut_down_system: string[]
          screen_timeout_ac_minutes: number
          screen_timeout_dc_minutes: number
          shutdown_clear_virtual_memory: boolean
          sleep_timeout_ac_minutes: number
          sleep_timeout_dc_minutes: number
          system_objects_strengthen_default_permissions: boolean
          telemetry_level: number
          updated_at: string
        }
        Insert: {
          audit_account_logon?: string
          audit_account_management?: string
          audit_ds_access?: string
          audit_logon_events?: string
          audit_object_access?: string
          audit_policy_change?: string
          audit_privilege_use?: string
          audit_process_tracking?: string
          audit_system_events?: string
          created_at?: string
          created_by?: string | null
          custom_registry_settings?: Json
          description?: string | null
          devices_restrict_cd_rom?: boolean
          devices_restrict_floppy?: boolean
          disable_cmd_prompt?: boolean
          disable_consumer_features?: boolean
          disable_control_panel?: boolean
          disable_cortana?: boolean
          disable_game_bar?: boolean
          disable_ipv6?: boolean
          disable_lock_screen_camera?: boolean
          disable_onedrive?: boolean
          disable_registry_tools?: boolean
          disable_run_command?: boolean
          disable_store_apps?: boolean
          disable_task_manager?: boolean
          disable_telemetry?: boolean
          disable_wifi_sense?: boolean
          enable_windows_firewall_domain?: boolean
          enable_windows_firewall_private?: boolean
          enable_windows_firewall_public?: boolean
          id?: string
          interactive_logon_dont_display_last_user?: boolean
          interactive_logon_message_text?: string
          interactive_logon_message_title?: string
          interactive_logon_require_ctrl_alt_del?: boolean
          is_default?: boolean
          lockout_duration_minutes?: number
          lockout_reset_minutes?: number
          lockout_threshold?: number
          name: string
          network_access_restrict_anonymous?: boolean
          network_security_lan_manager_level?: number
          network_security_min_session_security_ntlm?: boolean
          organization_id: string
          password_complexity_enabled?: boolean
          password_history_count?: number
          password_max_age_days?: number
          password_min_age_days?: number
          password_min_length?: number
          password_reversible_encryption?: boolean
          remote_desktop_enabled?: boolean
          remote_desktop_max_sessions?: number
          remote_desktop_nla_required?: boolean
          require_password_on_wake?: boolean
          right_change_system_time?: string[]
          right_debug_programs?: string[]
          right_deny_local_logon?: string[]
          right_deny_network_logon?: string[]
          right_deny_remote_desktop_logon?: string[]
          right_local_logon?: string[]
          right_network_logon?: string[]
          right_remote_desktop_logon?: string[]
          right_shut_down_system?: string[]
          screen_timeout_ac_minutes?: number
          screen_timeout_dc_minutes?: number
          shutdown_clear_virtual_memory?: boolean
          sleep_timeout_ac_minutes?: number
          sleep_timeout_dc_minutes?: number
          system_objects_strengthen_default_permissions?: boolean
          telemetry_level?: number
          updated_at?: string
        }
        Update: {
          audit_account_logon?: string
          audit_account_management?: string
          audit_ds_access?: string
          audit_logon_events?: string
          audit_object_access?: string
          audit_policy_change?: string
          audit_privilege_use?: string
          audit_process_tracking?: string
          audit_system_events?: string
          created_at?: string
          created_by?: string | null
          custom_registry_settings?: Json
          description?: string | null
          devices_restrict_cd_rom?: boolean
          devices_restrict_floppy?: boolean
          disable_cmd_prompt?: boolean
          disable_consumer_features?: boolean
          disable_control_panel?: boolean
          disable_cortana?: boolean
          disable_game_bar?: boolean
          disable_ipv6?: boolean
          disable_lock_screen_camera?: boolean
          disable_onedrive?: boolean
          disable_registry_tools?: boolean
          disable_run_command?: boolean
          disable_store_apps?: boolean
          disable_task_manager?: boolean
          disable_telemetry?: boolean
          disable_wifi_sense?: boolean
          enable_windows_firewall_domain?: boolean
          enable_windows_firewall_private?: boolean
          enable_windows_firewall_public?: boolean
          id?: string
          interactive_logon_dont_display_last_user?: boolean
          interactive_logon_message_text?: string
          interactive_logon_message_title?: string
          interactive_logon_require_ctrl_alt_del?: boolean
          is_default?: boolean
          lockout_duration_minutes?: number
          lockout_reset_minutes?: number
          lockout_threshold?: number
          name?: string
          network_access_restrict_anonymous?: boolean
          network_security_lan_manager_level?: number
          network_security_min_session_security_ntlm?: boolean
          organization_id?: string
          password_complexity_enabled?: boolean
          password_history_count?: number
          password_max_age_days?: number
          password_min_age_days?: number
          password_min_length?: number
          password_reversible_encryption?: boolean
          remote_desktop_enabled?: boolean
          remote_desktop_max_sessions?: number
          remote_desktop_nla_required?: boolean
          require_password_on_wake?: boolean
          right_change_system_time?: string[]
          right_debug_programs?: string[]
          right_deny_local_logon?: string[]
          right_deny_network_logon?: string[]
          right_deny_remote_desktop_logon?: string[]
          right_local_logon?: string[]
          right_network_logon?: string[]
          right_remote_desktop_logon?: string[]
          right_shut_down_system?: string[]
          screen_timeout_ac_minutes?: number
          screen_timeout_dc_minutes?: number
          shutdown_clear_virtual_memory?: boolean
          sleep_timeout_ac_minutes?: number
          sleep_timeout_dc_minutes?: number
          system_objects_strengthen_default_permissions?: boolean
          telemetry_level?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gpo_policies_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gpo_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "gpo_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_rule_set_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          group_id: string
          id: string
          priority: number
          rule_set_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          group_id: string
          id?: string
          priority?: number
          rule_set_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          group_id?: string
          id?: string
          priority?: number
          rule_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_rule_set_assignments_group_id_fkey"
            columns: ["group_id"]
            referencedRelation: "endpoint_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_rule_set_assignments_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      hardening_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system_default: boolean
          name: string
          organization_id: string
          os_target: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system_default?: boolean
          name: string
          organization_id: string
          os_target?: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system_default?: boolean
          name?: string
          organization_id?: string
          os_target?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hardening_profiles_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "hardening_profiles_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hardening_recommendations: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          category: string
          created_at: string
          current_value: string | null
          description: string | null
          endpoint_id: string
          id: string
          is_applied: boolean
          is_compliant: boolean
          organization_id: string
          policy_reference: string | null
          recommended_value: string | null
          remediation_action: string | null
          severity: string
          title: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          category: string
          created_at?: string
          current_value?: string | null
          description?: string | null
          endpoint_id: string
          id?: string
          is_applied?: boolean
          is_compliant?: boolean
          organization_id: string
          policy_reference?: string | null
          recommended_value?: string | null
          remediation_action?: string | null
          severity?: string
          title: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          category?: string
          created_at?: string
          current_value?: string | null
          description?: string | null
          endpoint_id?: string
          id?: string
          is_applied?: boolean
          is_compliant?: boolean
          organization_id?: string
          policy_reference?: string | null
          recommended_value?: string | null
          remediation_action?: string | null
          severity?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hardening_recommendations_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hardening_recommendations_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hardening_recommendations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "hardening_recommendations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          hunt_type: string
          id: string
          matches_found: number | null
          name: string
          organization_id: string
          parameters: Json
          started_at: string | null
          status: string
          total_endpoints: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hunt_type: string
          id?: string
          matches_found?: number | null
          name: string
          organization_id: string
          parameters?: Json
          started_at?: string | null
          status?: string
          total_endpoints?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hunt_type?: string
          id?: string
          matches_found?: number | null
          name?: string
          organization_id?: string
          parameters?: Json
          started_at?: string | null
          status?: string
          total_endpoints?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_jobs_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "hunt_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hunt_matches: {
        Row: {
          context: Json | null
          created_at: string
          endpoint_id: string
          hunt_job_id: string
          id: string
          ioc_id: string | null
          match_source: string
          matched_value: string
          reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          endpoint_id: string
          hunt_job_id: string
          id?: string
          ioc_id?: string | null
          match_source: string
          matched_value: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          endpoint_id?: string
          hunt_job_id?: string
          id?: string
          ioc_id?: string | null
          match_source?: string
          matched_value?: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hunt_matches_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_matches_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_matches_hunt_job_id_fkey"
            columns: ["hunt_job_id"]
            referencedRelation: "hunt_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_matches_ioc_id_fkey"
            columns: ["ioc_id"]
            referencedRelation: "ioc_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hunt_matches_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_ai_assessments: {
        Row: {
          confidence: string | null
          error_message: string | null
          generated_at: string
          incident_id: string
          mitre_tags: string[] | null
          model: string | null
          organization_id: string
          raw_response: Json | null
          severity_override: string | null
          suggested_action: string | null
          suggested_command: string | null
          summary: string | null
        }
        Insert: {
          confidence?: string | null
          error_message?: string | null
          generated_at?: string
          incident_id: string
          mitre_tags?: string[] | null
          model?: string | null
          organization_id: string
          raw_response?: Json | null
          severity_override?: string | null
          suggested_action?: string | null
          suggested_command?: string | null
          summary?: string | null
        }
        Update: {
          confidence?: string | null
          error_message?: string | null
          generated_at?: string
          incident_id?: string
          mitre_tags?: string[] | null
          model?: string | null
          organization_id?: string
          raw_response?: Json | null
          severity_override?: string | null
          suggested_action?: string | null
          suggested_command?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_ai_assessments_incident_id_fkey"
            columns: ["incident_id"]
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_ai_assessments_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "incident_ai_assessments_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          incident_id: string
          visibility: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          incident_id: string
          visibility?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          incident_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_notes_incident_id_fkey"
            columns: ["incident_id"]
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          alert_id: string | null
          assigned_at: string | null
          assignee_id: string | null
          created_at: string
          description: string | null
          endpoint_id: string | null
          id: string
          kind: string
          opened_at: string
          organization_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          sla_due_at: string
          status: string
          threat_id: string | null
          title: string
          triaged_at: string | null
          updated_at: string
        }
        Insert: {
          alert_id?: string | null
          assigned_at?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          endpoint_id?: string | null
          id?: string
          kind: string
          opened_at?: string
          organization_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          sla_due_at: string
          status?: string
          threat_id?: string | null
          title: string
          triaged_at?: string | null
          updated_at?: string
        }
        Update: {
          alert_id?: string | null
          assigned_at?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          endpoint_id?: string | null
          id?: string
          kind?: string
          opened_at?: string
          organization_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          sla_due_at?: string
          status?: string
          threat_id?: string | null
          title?: string
          triaged_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_alert_id_fkey"
            columns: ["alert_id"]
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_threat_id_fkey"
            columns: ["threat_id"]
            referencedRelation: "endpoint_threats"
            referencedColumns: ["id"]
          },
        ]
      }
      ioc_library: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          hash_type: string | null
          id: string
          ioc_type: string
          is_active: boolean
          organization_id: string
          severity: string
          source: string
          tags: string[] | null
          threat_name: string | null
          value: string
          vt_detection_ratio: string | null
          vt_enriched_at: string | null
          vt_enrichment: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hash_type?: string | null
          id?: string
          ioc_type: string
          is_active?: boolean
          organization_id: string
          severity?: string
          source?: string
          tags?: string[] | null
          threat_name?: string | null
          value: string
          vt_detection_ratio?: string | null
          vt_enriched_at?: string | null
          vt_enrichment?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          hash_type?: string | null
          id?: string
          ioc_type?: string
          is_active?: boolean
          organization_id?: string
          severity?: string
          source?: string
          tags?: string[] | null
          threat_name?: string | null
          value?: string
          vt_detection_ratio?: string | null
          vt_enriched_at?: string | null
          vt_enrichment?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ioc_library_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ioc_library_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ioc_library_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linux_firewall_snapshots: {
        Row: {
          captured_at: string
          default_in: string | null
          default_out: string | null
          endpoint_id: string
          frontend: string
          id: string
          raw_text: string | null
          risky_count: number
          rule_count: number
        }
        Insert: {
          captured_at?: string
          default_in?: string | null
          default_out?: string | null
          endpoint_id: string
          frontend: string
          id?: string
          raw_text?: string | null
          risky_count?: number
          rule_count?: number
        }
        Update: {
          captured_at?: string
          default_in?: string | null
          default_out?: string | null
          endpoint_id?: string
          frontend?: string
          id?: string
          raw_text?: string | null
          risky_count?: number
          rule_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "linux_firewall_snapshots_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linux_firewall_snapshots_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      linux_listening_ports: {
        Row: {
          bind_addr: unknown
          captured_at: string
          comm: string | null
          endpoint_id: string
          id: string
          pid: number | null
          port: number
          proto: string
        }
        Insert: {
          bind_addr: unknown
          captured_at?: string
          comm?: string | null
          endpoint_id: string
          id?: string
          pid?: number | null
          port: number
          proto: string
        }
        Update: {
          bind_addr?: unknown
          captured_at?: string
          comm?: string | null
          endpoint_id?: string
          id?: string
          pid?: number | null
          port?: number
          proto?: string
        }
        Relationships: [
          {
            foreignKeyName: "linux_listening_ports_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linux_listening_ports_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_audit_events: {
        Row: {
          activity_display_name: string | null
          additional_details: Json | null
          category: string | null
          graph_event_id: string
          id: string
          ingested_at: string
          initiated_by_app_id: string | null
          initiated_by_app_name: string | null
          initiated_by_user_id: string | null
          initiated_by_user_upn: string | null
          m365_tenant_id: string
          occurred_at: string
          operation_type: string | null
          organization_id: string
          raw_event: Json | null
          result: string | null
          result_reason: string | null
          target_resources: Json | null
        }
        Insert: {
          activity_display_name?: string | null
          additional_details?: Json | null
          category?: string | null
          graph_event_id: string
          id?: string
          ingested_at?: string
          initiated_by_app_id?: string | null
          initiated_by_app_name?: string | null
          initiated_by_user_id?: string | null
          initiated_by_user_upn?: string | null
          m365_tenant_id: string
          occurred_at: string
          operation_type?: string | null
          organization_id: string
          raw_event?: Json | null
          result?: string | null
          result_reason?: string | null
          target_resources?: Json | null
        }
        Update: {
          activity_display_name?: string | null
          additional_details?: Json | null
          category?: string | null
          graph_event_id?: string
          id?: string
          ingested_at?: string
          initiated_by_app_id?: string | null
          initiated_by_app_name?: string | null
          initiated_by_user_id?: string | null
          initiated_by_user_upn?: string | null
          m365_tenant_id?: string
          occurred_at?: string
          operation_type?: string | null
          organization_id?: string
          raw_event?: Json | null
          result?: string | null
          result_reason?: string | null
          target_resources?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_audit_events_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_audit_events_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_detection_dedup: {
        Row: {
          detection_key: string
          last_fired_at: string
        }
        Insert: {
          detection_key: string
          last_fired_at?: string
        }
        Update: {
          detection_key?: string
          last_fired_at?: string
        }
        Relationships: []
      }
      m365_mailbox_rules: {
        Row: {
          actions: Json | null
          conditions: Json | null
          deletes_messages: boolean
          enabled: boolean
          first_seen_at: string
          forward_to_addresses: string[] | null
          forwards_externally: boolean
          id: string
          is_active: boolean
          last_seen_at: string
          m365_tenant_id: string
          moves_to_folder: string | null
          organization_id: string
          raw_rule: Json | null
          rule_id: string
          rule_name: string | null
          user_id: string
          user_principal_name: string
        }
        Insert: {
          actions?: Json | null
          conditions?: Json | null
          deletes_messages?: boolean
          enabled?: boolean
          first_seen_at?: string
          forward_to_addresses?: string[] | null
          forwards_externally?: boolean
          id?: string
          is_active?: boolean
          last_seen_at?: string
          m365_tenant_id: string
          moves_to_folder?: string | null
          organization_id: string
          raw_rule?: Json | null
          rule_id: string
          rule_name?: string | null
          user_id: string
          user_principal_name: string
        }
        Update: {
          actions?: Json | null
          conditions?: Json | null
          deletes_messages?: boolean
          enabled?: boolean
          first_seen_at?: string
          forward_to_addresses?: string[] | null
          forwards_externally?: boolean
          id?: string
          is_active?: boolean
          last_seen_at?: string
          m365_tenant_id?: string
          moves_to_folder?: string | null
          organization_id?: string
          raw_rule?: Json | null
          rule_id?: string
          rule_name?: string | null
          user_id?: string
          user_principal_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_mailbox_rules_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_mailbox_rules_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_mailbox_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_mailbox_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_oauth_grants: {
        Row: {
          client_display_name: string | null
          client_id: string
          consent_type: string | null
          first_seen_at: string
          grant_id: string
          has_high_risk_scope: boolean
          high_risk_scopes_matched: string[] | null
          id: string
          is_active: boolean
          last_seen_at: string
          m365_tenant_id: string
          organization_id: string
          principal_upn: string | null
          principal_user_id: string | null
          raw_grant: Json | null
          scope: string | null
        }
        Insert: {
          client_display_name?: string | null
          client_id: string
          consent_type?: string | null
          first_seen_at?: string
          grant_id: string
          has_high_risk_scope?: boolean
          high_risk_scopes_matched?: string[] | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          m365_tenant_id: string
          organization_id: string
          principal_upn?: string | null
          principal_user_id?: string | null
          raw_grant?: Json | null
          scope?: string | null
        }
        Update: {
          client_display_name?: string | null
          client_id?: string
          consent_type?: string | null
          first_seen_at?: string
          grant_id?: string
          has_high_risk_scope?: boolean
          high_risk_scopes_matched?: string[] | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          m365_tenant_id?: string
          organization_id?: string
          principal_upn?: string | null
          principal_user_id?: string | null
          raw_grant?: Json | null
          scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_oauth_grants_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_oauth_grants_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_oauth_grants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_oauth_grants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_sign_in_events: {
        Row: {
          app_display_name: string | null
          city: string | null
          client_app_used: string | null
          conditional_access_status: string | null
          country: string | null
          graph_event_id: string
          id: string
          ingested_at: string
          ip_address: unknown
          is_interactive: boolean | null
          m365_tenant_id: string
          occurred_at: string
          organization_id: string
          raw_event: Json | null
          risk_event_types: string[] | null
          risk_level: string | null
          risk_state: string | null
          status_error_code: number | null
          status_failure_reason: string | null
          user_display_name: string | null
          user_id: string | null
          user_principal_name: string | null
        }
        Insert: {
          app_display_name?: string | null
          city?: string | null
          client_app_used?: string | null
          conditional_access_status?: string | null
          country?: string | null
          graph_event_id: string
          id?: string
          ingested_at?: string
          ip_address?: unknown
          is_interactive?: boolean | null
          m365_tenant_id: string
          occurred_at: string
          organization_id: string
          raw_event?: Json | null
          risk_event_types?: string[] | null
          risk_level?: string | null
          risk_state?: string | null
          status_error_code?: number | null
          status_failure_reason?: string | null
          user_display_name?: string | null
          user_id?: string | null
          user_principal_name?: string | null
        }
        Update: {
          app_display_name?: string | null
          city?: string | null
          client_app_used?: string | null
          conditional_access_status?: string | null
          country?: string | null
          graph_event_id?: string
          id?: string
          ingested_at?: string
          ip_address?: unknown
          is_interactive?: boolean | null
          m365_tenant_id?: string
          occurred_at?: string
          organization_id?: string
          raw_event?: Json | null
          risk_event_types?: string[] | null
          risk_level?: string | null
          risk_state?: string | null
          status_error_code?: number | null
          status_failure_reason?: string | null
          user_display_name?: string | null
          user_id?: string | null
          user_principal_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_sign_in_events_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_sign_in_events_m365_tenant_id_fkey"
            columns: ["m365_tenant_id"]
            referencedRelation: "m365_tenants_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_sign_in_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_sign_in_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_tenants: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          connected_by: string | null
          consent_state: string
          created_at: string
          id: string
          last_poll_at: string | null
          last_poll_error: string | null
          organization_id: string
          refresh_token: string | null
          remediation_enabled: boolean
          remediation_scopes: string[]
          scopes: string[]
          tenant_display_name: string | null
          tenant_domain: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_by?: string | null
          consent_state?: string
          created_at?: string
          id?: string
          last_poll_at?: string | null
          last_poll_error?: string | null
          organization_id: string
          refresh_token?: string | null
          remediation_enabled?: boolean
          remediation_scopes?: string[]
          scopes?: string[]
          tenant_display_name?: string | null
          tenant_domain?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_by?: string | null
          consent_state?: string
          created_at?: string
          id?: string
          last_poll_at?: string | null
          last_poll_error?: string | null
          organization_id?: string
          refresh_token?: string | null
          remediation_enabled?: boolean
          remediation_scopes?: string[]
          scopes?: string[]
          tenant_display_name?: string | null
          tenant_domain?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "m365_tenants_connected_by_fkey"
            columns: ["connected_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_tenants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_tenants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_sites: {
        Row: {
          active_theme: string | null
          created_at: string
          enrolled_via: string | null
          id: string
          is_active: boolean
          last_ip: unknown
          last_seen_at: string | null
          name: string | null
          organization_id: string
          php_version: string | null
          plugin_count: number | null
          site_secret_hash: string
          site_url: string
          updated_at: string
          wp_version: string | null
        }
        Insert: {
          active_theme?: string | null
          created_at?: string
          enrolled_via?: string | null
          id?: string
          is_active?: boolean
          last_ip?: unknown
          last_seen_at?: string | null
          name?: string | null
          organization_id: string
          php_version?: string | null
          plugin_count?: number | null
          site_secret_hash: string
          site_url: string
          updated_at?: string
          wp_version?: string | null
        }
        Update: {
          active_theme?: string | null
          created_at?: string
          enrolled_via?: string | null
          id?: string
          is_active?: boolean
          last_ip?: unknown
          last_seen_at?: string | null
          name?: string | null
          organization_id?: string
          php_version?: string | null
          plugin_count?: number | null
          site_secret_hash?: string
          site_url?: string
          updated_at?: string
          wp_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitored_sites_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "monitored_sites_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_alert_recipients: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          enabled: boolean
          id: string
          min_severity: string
          name: string | null
          organization_id: string
          role_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          enabled?: boolean
          id?: string
          min_severity?: string
          name?: string | null
          organization_id: string
          role_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          enabled?: boolean
          id?: string
          min_severity?: string
          name?: string | null
          organization_id?: string
          role_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_alert_recipients_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_alert_recipients_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_report_recipients: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          monthly: boolean
          name: string | null
          organization_id: string
          quarterly: boolean
          role_label: string | null
          updated_at: string
          weekly: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          monthly?: boolean
          name?: string | null
          organization_id: string
          quarterly?: boolean
          role_label?: string | null
          updated_at?: string
          weekly?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          monthly?: boolean
          name?: string | null
          organization_id?: string
          quarterly?: boolean
          role_label?: string | null
          updated_at?: string
          weekly?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "org_report_recipients_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_report_recipients_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_invited_by_fkey"
            columns: ["invited_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_email_remediation_enabled: boolean
          ai_endpoint_remediation_enabled: boolean
          ai_investigation_enabled: boolean
          ai_soc_daily_cap_cents: number
          ai_soc_enabled: boolean
          ai_triage_enabled: boolean
          created_at: string
          device_quota_override: number | null
          dns_module_enabled: boolean
          event_log_retention_days: number
          id: string
          legacy_hardening_enabled: boolean
          name: string
          network_module_enabled: boolean
          organization_type: string
          parent_partner_id: string | null
          router_module_enabled: boolean
          slug: string
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          updated_at: string
        }
        Insert: {
          ai_email_remediation_enabled?: boolean
          ai_endpoint_remediation_enabled?: boolean
          ai_investigation_enabled?: boolean
          ai_soc_daily_cap_cents?: number
          ai_soc_enabled?: boolean
          ai_triage_enabled?: boolean
          created_at?: string
          device_quota_override?: number | null
          dns_module_enabled?: boolean
          event_log_retention_days?: number
          id?: string
          legacy_hardening_enabled?: boolean
          name: string
          network_module_enabled?: boolean
          organization_type?: string
          parent_partner_id?: string | null
          router_module_enabled?: boolean
          slug: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          updated_at?: string
        }
        Update: {
          ai_email_remediation_enabled?: boolean
          ai_endpoint_remediation_enabled?: boolean
          ai_investigation_enabled?: boolean
          ai_soc_daily_cap_cents?: number
          ai_soc_enabled?: boolean
          ai_triage_enabled?: boolean
          created_at?: string
          device_quota_override?: number | null
          dns_module_enabled?: boolean
          event_log_retention_days?: number
          id?: string
          legacy_hardening_enabled?: boolean
          name?: string
          network_module_enabled?: boolean
          organization_type?: string
          parent_partner_id?: string | null
          router_module_enabled?: boolean
          slug?: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_partner_id_fkey"
            columns: ["parent_partner_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organizations_parent_partner_id_fkey"
            columns: ["parent_partner_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          advanced_threat_analytics: boolean
          ai_security_advisor: boolean
          api_access: boolean
          compliance_reporting: boolean
          created_at: string
          custom_policies: boolean
          id: string
          max_devices: number | null
          plan: Database["public"]["Enums"]["subscription_plan"]
          priority_support: boolean
          updated_at: string
        }
        Insert: {
          advanced_threat_analytics?: boolean
          ai_security_advisor?: boolean
          api_access?: boolean
          compliance_reporting?: boolean
          created_at?: string
          custom_policies?: boolean
          id?: string
          max_devices?: number | null
          plan: Database["public"]["Enums"]["subscription_plan"]
          priority_support?: boolean
          updated_at?: string
        }
        Update: {
          advanced_threat_analytics?: boolean
          ai_security_advisor?: boolean
          api_access?: boolean
          compliance_reporting?: boolean
          created_at?: string
          custom_policies?: boolean
          id?: string
          max_devices?: number | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          priority_support?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_secret: boolean
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_secret?: boolean
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_secret?: boolean
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      policy_audit_findings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          details: Json | null
          finding_type: string
          first_seen_at: string
          id: string
          is_approved: boolean | null
          last_seen_at: string
          occurrence_count: number
          session_id: string
          source_endpoint_id: string | null
          value: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          details?: Json | null
          finding_type: string
          first_seen_at?: string
          id?: string
          is_approved?: boolean | null
          last_seen_at?: string
          occurrence_count?: number
          session_id: string
          source_endpoint_id?: string | null
          value: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          details?: Json | null
          finding_type?: string
          first_seen_at?: string
          id?: string
          is_approved?: boolean | null
          last_seen_at?: string
          occurrence_count?: number
          session_id?: string
          source_endpoint_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_audit_findings_session_id_fkey"
            columns: ["session_id"]
            referencedRelation: "policy_audit_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_audit_findings_source_endpoint_id_fkey"
            columns: ["source_endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_audit_findings_source_endpoint_id_fkey"
            columns: ["source_endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_audit_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          planned_duration_days: number
          policy_id: string
          policy_type: string
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          planned_duration_days?: number
          policy_id: string
          policy_type: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          planned_duration_days?: number
          policy_id?: string
          policy_type?: string
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_audit_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "policy_audit_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      remote_desktop_sessions: {
        Row: {
          duration_seconds: number
          ended_at: string | null
          endpoint_id: string
          error_message: string | null
          id: string
          initiated_by: string | null
          mesh_node_id: string | null
          organization_id: string
          reason: string | null
          session_url: string | null
          started_at: string
          status: string
          transport: string
        }
        Insert: {
          duration_seconds?: number
          ended_at?: string | null
          endpoint_id: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          mesh_node_id?: string | null
          organization_id: string
          reason?: string | null
          session_url?: string | null
          started_at?: string
          status?: string
          transport?: string
        }
        Update: {
          duration_seconds?: number
          ended_at?: string | null
          endpoint_id?: string
          error_message?: string | null
          id?: string
          initiated_by?: string | null
          mesh_node_id?: string | null
          organization_id?: string
          reason?: string | null
          session_url?: string | null
          started_at?: string
          status?: string
          transport?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_desktop_sessions_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_desktop_sessions_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_desktop_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "remote_desktop_sessions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      response_playbooks: {
        Row: {
          actions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_enabled: boolean
          min_severity: string | null
          name: string
          organization_id: string | null
          threat_name_like: string | null
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          min_severity?: string | null
          name: string
          organization_id?: string | null
          threat_name_like?: string | null
          trigger_kind: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          min_severity?: string | null
          name?: string
          organization_id?: string | null
          threat_name_like?: string | null
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_playbooks_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "response_playbooks_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      router_dns_records: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          priority: number | null
          record_name: string
          record_type: string
          record_value: string
          ttl: number
          zone_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number | null
          record_name: string
          record_type?: string
          record_value: string
          ttl?: number
          zone_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number | null
          record_name?: string
          record_type?: string
          record_value?: string
          ttl?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_dns_records_zone_id_fkey"
            columns: ["zone_id"]
            referencedRelation: "router_dns_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      router_dns_zones: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          organization_id: string
          router_id: string
          updated_at: string
          upstream_servers: string[] | null
          zone_name: string
          zone_type: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id: string
          router_id: string
          updated_at?: string
          upstream_servers?: string[] | null
          zone_name: string
          zone_type?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id?: string
          router_id?: string
          updated_at?: string
          upstream_servers?: string[] | null
          zone_name?: string
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_dns_zones_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "router_dns_zones_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_dns_zones_router_id_fkey"
            columns: ["router_id"]
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
        ]
      }
      router_enrollment_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          label: string
          max_uses: number | null
          organization_id: string
          token_hash: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          max_uses?: number | null
          organization_id: string
          token_hash?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          max_uses?: number | null
          organization_id?: string
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "router_enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "router_enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      router_firewall_rules: {
        Row: {
          action: string
          created_at: string
          destination_address: string | null
          destination_port: string | null
          direction: string
          enabled: boolean
          id: string
          interface: string | null
          log_enabled: boolean
          name: string
          order_priority: number
          organization_id: string
          protocol: string | null
          router_id: string
          source_address: string | null
          source_port: string | null
          updated_at: string
        }
        Insert: {
          action?: string
          created_at?: string
          destination_address?: string | null
          destination_port?: string | null
          direction?: string
          enabled?: boolean
          id?: string
          interface?: string | null
          log_enabled?: boolean
          name: string
          order_priority?: number
          organization_id: string
          protocol?: string | null
          router_id: string
          source_address?: string | null
          source_port?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          destination_address?: string | null
          destination_port?: string | null
          direction?: string
          enabled?: boolean
          id?: string
          interface?: string | null
          log_enabled?: boolean
          name?: string
          order_priority?: number
          organization_id?: string
          protocol?: string | null
          router_id?: string
          source_address?: string | null
          source_port?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_firewall_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "router_firewall_rules_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_firewall_rules_router_id_fkey"
            columns: ["router_id"]
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
        ]
      }
      router_tunnels: {
        Row: {
          config_data: Json | null
          created_at: string
          enabled: boolean
          encryption: string | null
          id: string
          name: string
          organization_id: string
          psk_hint: string | null
          router_a_endpoint: string | null
          router_a_id: string
          router_a_subnet: string | null
          router_b_endpoint: string | null
          router_b_id: string | null
          router_b_subnet: string | null
          status: string
          tunnel_type: string
          updated_at: string
        }
        Insert: {
          config_data?: Json | null
          created_at?: string
          enabled?: boolean
          encryption?: string | null
          id?: string
          name: string
          organization_id: string
          psk_hint?: string | null
          router_a_endpoint?: string | null
          router_a_id: string
          router_a_subnet?: string | null
          router_b_endpoint?: string | null
          router_b_id?: string | null
          router_b_subnet?: string | null
          status?: string
          tunnel_type?: string
          updated_at?: string
        }
        Update: {
          config_data?: Json | null
          created_at?: string
          enabled?: boolean
          encryption?: string | null
          id?: string
          name?: string
          organization_id?: string
          psk_hint?: string | null
          router_a_endpoint?: string | null
          router_a_id?: string
          router_a_subnet?: string | null
          router_b_endpoint?: string | null
          router_b_id?: string | null
          router_b_subnet?: string | null
          status?: string
          tunnel_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_tunnels_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "router_tunnels_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_tunnels_router_a_id_fkey"
            columns: ["router_a_id"]
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_tunnels_router_b_id_fkey"
            columns: ["router_b_id"]
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
        ]
      }
      router_uptime_logs: {
        Row: {
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          router_id: string
        }
        Insert: {
          created_at?: string
          event_time?: string
          event_type: string
          id?: string
          organization_id: string
          router_id: string
        }
        Update: {
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          router_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "router_uptime_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "router_uptime_logs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "router_uptime_logs_router_id_fkey"
            columns: ["router_id"]
            referencedRelation: "routers"
            referencedColumns: ["id"]
          },
        ]
      }
      routers: {
        Row: {
          agent_token_hash: string | null
          config_profile: Json | null
          created_at: string
          firmware_version: string | null
          hostname: string
          id: string
          is_online: boolean
          lan_subnets: string[] | null
          last_seen_at: string | null
          location: string | null
          management_ip: string | null
          model: string | null
          notes: string | null
          organization_id: string
          serial_number: string | null
          site_name: string | null
          updated_at: string
          vendor: string
          wan_ip: string | null
        }
        Insert: {
          agent_token_hash?: string | null
          config_profile?: Json | null
          created_at?: string
          firmware_version?: string | null
          hostname: string
          id?: string
          is_online?: boolean
          lan_subnets?: string[] | null
          last_seen_at?: string | null
          location?: string | null
          management_ip?: string | null
          model?: string | null
          notes?: string | null
          organization_id: string
          serial_number?: string | null
          site_name?: string | null
          updated_at?: string
          vendor: string
          wan_ip?: string | null
        }
        Update: {
          agent_token_hash?: string | null
          config_profile?: Json | null
          created_at?: string
          firmware_version?: string | null
          hostname?: string
          id?: string
          is_online?: boolean
          lan_subnets?: string[] | null
          last_seen_at?: string | null
          location?: string | null
          management_ip?: string | null
          model?: string | null
          notes?: string | null
          organization_id?: string
          serial_number?: string | null
          site_name?: string | null
          updated_at?: string
          vendor?: string
          wan_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routers_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "routers_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      security_reports: {
        Row: {
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          organization_id: string
          pdf_storage_path: string | null
          report_data: Json
          report_period_end: string
          report_period_start: string
          report_title: string
          report_type: string
          section_visibility: Json
        }
        Insert: {
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          organization_id: string
          pdf_storage_path?: string | null
          report_data?: Json
          report_period_end: string
          report_period_start: string
          report_title: string
          report_type: string
          section_visibility?: Json
        }
        Update: {
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          organization_id?: string
          pdf_storage_path?: string | null
          report_data?: Json
          report_period_end?: string
          report_period_start?: string
          report_title?: string
          report_type?: string
          section_visibility?: Json
        }
        Relationships: [
          {
            foreignKeyName: "security_reports_generated_by_fkey"
            columns: ["generated_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_reports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "security_reports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audit_findings: {
        Row: {
          category: string
          description: string | null
          evidence: Json | null
          finding_key: string
          first_seen_at: string
          id: string
          last_seen_at: string
          organization_id: string
          recommendation: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          site_id: string
          status: string
          title: string
        }
        Insert: {
          category: string
          description?: string | null
          evidence?: Json | null
          finding_key: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          organization_id: string
          recommendation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          site_id: string
          status?: string
          title: string
        }
        Update: {
          category?: string
          description?: string | null
          evidence?: Json | null
          finding_key?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          organization_id?: string
          recommendation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          site_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_audit_findings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "site_audit_findings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audit_findings_site_id_fkey"
            columns: ["site_id"]
            referencedRelation: "monitored_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_enrollment_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          max_uses: number
          note: string | null
          organization_id: string
          token: string
          use_count: number
          used_at: string | null
          used_by_site_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          max_uses?: number
          note?: string | null
          organization_id: string
          token: string
          use_count?: number
          used_at?: string | null
          used_by_site_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          max_uses?: number
          note?: string | null
          organization_id?: string
          token?: string
          use_count?: number
          used_at?: string | null
          used_by_site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "site_enrollment_tokens_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_enrollment_tokens_used_by_site_id_fkey"
            columns: ["used_by_site_id"]
            referencedRelation: "monitored_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_event_logs: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_event_logs_org_fk"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "site_event_logs_org_fk"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_event_logs_site_fk"
            columns: ["site_id"]
            referencedRelation: "monitored_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_event_logs_2026_03: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: []
      }
      site_event_logs_2026_04: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: []
      }
      site_event_logs_2026_05: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: []
      }
      site_event_logs_2026_06: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: []
      }
      site_event_logs_2026_07: {
        Row: {
          actor_ip: unknown
          actor_user_login: string | null
          created_at: string
          event_time: string
          event_type: string
          id: string
          organization_id: string
          raw: Json | null
          severity: string
          site_id: string
          summary: string
          target: string | null
        }
        Insert: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          organization_id: string
          raw?: Json | null
          severity?: string
          site_id: string
          summary: string
          target?: string | null
        }
        Update: {
          actor_ip?: unknown
          actor_user_login?: string | null
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          organization_id?: string
          raw?: Json | null
          severity?: string
          site_id?: string
          summary?: string
          target?: string | null
        }
        Relationships: []
      }
      site_protection_settings: {
        Row: {
          organization_id: string
          settings: Json
          settings_version: number
          site_id: string
          updated_at: string
        }
        Insert: {
          organization_id: string
          settings?: Json
          settings_version?: number
          site_id: string
          updated_at?: string
        }
        Update: {
          organization_id?: string
          settings?: Json
          settings_version?: number
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_protection_settings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "site_protection_settings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_protection_settings_site_id_fkey"
            columns: ["site_id"]
            referencedRelation: "monitored_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      sysmon_events: {
        Row: {
          command_line: string | null
          created_at: string
          current_directory: string | null
          destination_hostname: string | null
          destination_ip: string | null
          destination_port: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes: Json | null
          id: string
          image: string | null
          initiated: boolean | null
          integrity_level: string | null
          organization_id: string
          parent_command_line: string | null
          parent_image: string | null
          parent_process_guid: string | null
          parent_process_id: number | null
          process_guid: string | null
          process_id: number | null
          protocol: string | null
          raw: Json | null
          record_id: number | null
          source_hostname: string | null
          source_ip: string | null
          source_port: number | null
          target_filename: string | null
          user_name: string | null
        }
        Insert: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Update: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id?: string
          event_id?: number
          event_time?: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id?: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sysmon_events_endpoint_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sysmon_events_endpoint_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sysmon_events_org_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sysmon_events_org_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sysmon_events_2026_04: {
        Row: {
          command_line: string | null
          created_at: string
          current_directory: string | null
          destination_hostname: string | null
          destination_ip: string | null
          destination_port: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes: Json | null
          id: string
          image: string | null
          initiated: boolean | null
          integrity_level: string | null
          organization_id: string
          parent_command_line: string | null
          parent_image: string | null
          parent_process_guid: string | null
          parent_process_id: number | null
          process_guid: string | null
          process_id: number | null
          protocol: string | null
          raw: Json | null
          record_id: number | null
          source_hostname: string | null
          source_ip: string | null
          source_port: number | null
          target_filename: string | null
          user_name: string | null
        }
        Insert: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Update: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id?: string
          event_id?: number
          event_time?: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id?: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      sysmon_events_2026_05: {
        Row: {
          command_line: string | null
          created_at: string
          current_directory: string | null
          destination_hostname: string | null
          destination_ip: string | null
          destination_port: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes: Json | null
          id: string
          image: string | null
          initiated: boolean | null
          integrity_level: string | null
          organization_id: string
          parent_command_line: string | null
          parent_image: string | null
          parent_process_guid: string | null
          parent_process_id: number | null
          process_guid: string | null
          process_id: number | null
          protocol: string | null
          raw: Json | null
          record_id: number | null
          source_hostname: string | null
          source_ip: string | null
          source_port: number | null
          target_filename: string | null
          user_name: string | null
        }
        Insert: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Update: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id?: string
          event_id?: number
          event_time?: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id?: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      sysmon_events_2026_06: {
        Row: {
          command_line: string | null
          created_at: string
          current_directory: string | null
          destination_hostname: string | null
          destination_ip: string | null
          destination_port: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes: Json | null
          id: string
          image: string | null
          initiated: boolean | null
          integrity_level: string | null
          organization_id: string
          parent_command_line: string | null
          parent_image: string | null
          parent_process_guid: string | null
          parent_process_id: number | null
          process_guid: string | null
          process_id: number | null
          protocol: string | null
          raw: Json | null
          record_id: number | null
          source_hostname: string | null
          source_ip: string | null
          source_port: number | null
          target_filename: string | null
          user_name: string | null
        }
        Insert: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Update: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id?: string
          event_id?: number
          event_time?: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id?: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      sysmon_events_2026_07: {
        Row: {
          command_line: string | null
          created_at: string
          current_directory: string | null
          destination_hostname: string | null
          destination_ip: string | null
          destination_port: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes: Json | null
          id: string
          image: string | null
          initiated: boolean | null
          integrity_level: string | null
          organization_id: string
          parent_command_line: string | null
          parent_image: string | null
          parent_process_guid: string | null
          parent_process_id: number | null
          process_guid: string | null
          process_id: number | null
          protocol: string | null
          raw: Json | null
          record_id: number | null
          source_hostname: string | null
          source_ip: string | null
          source_port: number | null
          target_filename: string | null
          user_name: string | null
        }
        Insert: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id: string
          event_id: number
          event_time: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Update: {
          command_line?: string | null
          created_at?: string
          current_directory?: string | null
          destination_hostname?: string | null
          destination_ip?: string | null
          destination_port?: number | null
          endpoint_id?: string
          event_id?: number
          event_time?: string
          hashes?: Json | null
          id?: string
          image?: string | null
          initiated?: boolean | null
          integrity_level?: string | null
          organization_id?: string
          parent_command_line?: string | null
          parent_image?: string | null
          parent_process_guid?: string | null
          parent_process_id?: number | null
          process_guid?: string | null
          process_id?: number | null
          protocol?: string | null
          raw?: Json | null
          record_id?: number | null
          source_hostname?: string | null
          source_ip?: string | null
          source_port?: number | null
          target_filename?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      uac_policies: {
        Row: {
          consent_prompt_admin: number
          consent_prompt_user: number
          created_at: string
          created_by: string | null
          description: string | null
          detect_installations: boolean
          enable_lua: boolean
          filter_administrator_token: boolean
          id: string
          is_default: boolean
          name: string
          organization_id: string
          prompt_on_secure_desktop: boolean
          updated_at: string
          validate_admin_signatures: boolean
        }
        Insert: {
          consent_prompt_admin?: number
          consent_prompt_user?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          detect_installations?: boolean
          enable_lua?: boolean
          filter_administrator_token?: boolean
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          prompt_on_secure_desktop?: boolean
          updated_at?: string
          validate_admin_signatures?: boolean
        }
        Update: {
          consent_prompt_admin?: number
          consent_prompt_user?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          detect_installations?: boolean
          enable_lua?: boolean
          filter_administrator_token?: boolean
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          prompt_on_secure_desktop?: boolean
          updated_at?: string
          validate_admin_signatures?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "uac_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "uac_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_findings: {
        Row: {
          affected_software: string
          affected_version: string | null
          created_at: string
          cve_id: string
          cvss_score: number | null
          description: string | null
          endpoint_id: string
          fixed_version: string | null
          id: string
          organization_id: string
          remediation: string | null
          resolved_at: string | null
          resolved_by: string | null
          scan_job_id: string | null
          severity: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          affected_software: string
          affected_version?: string | null
          created_at?: string
          cve_id: string
          cvss_score?: number | null
          description?: string | null
          endpoint_id: string
          fixed_version?: string | null
          id?: string
          organization_id: string
          remediation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scan_job_id?: string | null
          severity?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          affected_software?: string
          affected_version?: string | null
          created_at?: string
          cve_id?: string
          cvss_score?: number | null
          description?: string | null
          endpoint_id?: string
          fixed_version?: string | null
          id?: string
          organization_id?: string
          remediation?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scan_job_id?: string | null
          severity?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_findings_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "vulnerability_findings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_scan_job_id_fkey"
            columns: ["scan_job_id"]
            referencedRelation: "vulnerability_scan_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_scan_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          findings_count: number | null
          id: string
          organization_id: string
          scan_type: string
          scanned_endpoints: number | null
          started_at: string | null
          started_by: string | null
          status: string
          total_endpoints: number | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          findings_count?: number | null
          id?: string
          organization_id: string
          scan_type?: string
          scanned_endpoints?: number | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          total_endpoints?: number | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          findings_count?: number | null
          id?: string
          organization_id?: string
          scan_type?: string
          scanned_endpoints?: number | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          total_endpoints?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_scan_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "vulnerability_scan_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_baselines: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          policy_id: string
          snapshot_data: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          policy_id: string
          snapshot_data?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          policy_id?: string
          snapshot_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wdac_baselines_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "wdac_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_block_events: {
        Row: {
          blocked_at: string
          endpoint_id: string
          file_hash: string | null
          file_name: string | null
          file_path: string
          id: string
          ingested_at: string
          organization_id: string
          parent_process: string | null
          publisher: string | null
          rule_set_id: string | null
          user_name: string | null
        }
        Insert: {
          blocked_at: string
          endpoint_id: string
          file_hash?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          ingested_at?: string
          organization_id: string
          parent_process?: string | null
          publisher?: string | null
          rule_set_id?: string | null
          user_name?: string | null
        }
        Update: {
          blocked_at?: string
          endpoint_id?: string
          file_hash?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          ingested_at?: string
          organization_id?: string
          parent_process?: string | null
          publisher?: string | null
          rule_set_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wdac_block_events_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_block_events_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_block_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "wdac_block_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_block_events_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_discovered_apps: {
        Row: {
          discovery_source: string
          endpoint_id: string
          execution_count: number
          file_hash: string | null
          file_name: string
          file_path: string
          file_version: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          organization_id: string
          product_name: string | null
          publisher: string | null
          raw_data: Json | null
        }
        Insert: {
          discovery_source: string
          endpoint_id: string
          execution_count?: number
          file_hash?: string | null
          file_name: string
          file_path: string
          file_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          organization_id: string
          product_name?: string | null
          publisher?: string | null
          raw_data?: Json | null
        }
        Update: {
          discovery_source?: string
          endpoint_id?: string
          execution_count?: number
          file_hash?: string | null
          file_name?: string
          file_path?: string
          file_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          organization_id?: string
          product_name?: string | null
          publisher?: string | null
          raw_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "wdac_discovered_apps_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_discovered_apps_endpoint_id_fkey"
            columns: ["endpoint_id"]
            referencedRelation: "endpoints_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_discovered_apps_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "wdac_discovered_apps_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_policies: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          mode: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          mode?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          mode?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wdac_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "wdac_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_policy_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          rules: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          rules?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          rules?: Json
        }
        Relationships: []
      }
      wdac_rule_set_rings: {
        Row: {
          created_at: string
          group_id: string
          id: string
          mode: string
          ring_order: number
          rule_set_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          mode: string
          ring_order?: number
          rule_set_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          mode?: string
          ring_order?: number
          rule_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wdac_rule_set_rings_group_id_fkey"
            columns: ["group_id"]
            referencedRelation: "endpoint_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wdac_rule_set_rings_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_rule_set_rules: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          description: string | null
          file_version_min: string | null
          id: string
          product_name: string | null
          publisher_name: string | null
          rule_set_id: string
          rule_type: string
          value: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_version_min?: string | null
          id?: string
          product_name?: string | null
          publisher_name?: string | null
          rule_set_id: string
          rule_type: string
          value: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_version_min?: string | null
          id?: string
          product_name?: string | null
          publisher_name?: string | null
          rule_set_id?: string
          rule_type?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "wdac_rule_set_rules_rule_set_id_fkey"
            columns: ["rule_set_id"]
            referencedRelation: "wdac_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_rule_sets: {
        Row: {
          audit_window_days: number
          auto_promote: boolean
          created_at: string
          created_by: string | null
          description: string | null
          feature_enabled: boolean
          id: string
          mode: string
          name: string
          organization_id: string
          policy_version: number
          updated_at: string
        }
        Insert: {
          audit_window_days?: number
          auto_promote?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          feature_enabled?: boolean
          id?: string
          mode?: string
          name: string
          organization_id: string
          policy_version?: number
          updated_at?: string
        }
        Update: {
          audit_window_days?: number
          auto_promote?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          feature_enabled?: boolean
          id?: string
          mode?: string
          name?: string
          organization_id?: string
          policy_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wdac_rule_sets_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "wdac_rule_sets_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wdac_rules: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          description: string | null
          file_version_min: string | null
          id: string
          policy_id: string
          product_name: string | null
          publisher_name: string | null
          rule_type: string
          value: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_version_min?: string | null
          id?: string
          policy_id: string
          product_name?: string | null
          publisher_name?: string | null
          rule_type: string
          value: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_version_min?: string | null
          id?: string
          policy_id?: string
          product_name?: string | null
          publisher_name?: string | null
          rule_type?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "wdac_rules_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "wdac_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      windows_update_policies: {
        Row: {
          active_hours_end: number | null
          active_hours_start: number | null
          auto_update_mode: number | null
          created_at: string
          description: string | null
          feature_update_deferral: number | null
          id: string
          name: string
          organization_id: string
          pause_feature_updates: boolean | null
          pause_quality_updates: boolean | null
          quality_update_deferral: number | null
          updated_at: string
        }
        Insert: {
          active_hours_end?: number | null
          active_hours_start?: number | null
          auto_update_mode?: number | null
          created_at?: string
          description?: string | null
          feature_update_deferral?: number | null
          id?: string
          name: string
          organization_id: string
          pause_feature_updates?: boolean | null
          pause_quality_updates?: boolean | null
          quality_update_deferral?: number | null
          updated_at?: string
        }
        Update: {
          active_hours_end?: number | null
          active_hours_start?: number | null
          auto_update_mode?: number | null
          created_at?: string
          description?: string | null
          feature_update_deferral?: number | null
          id?: string
          name?: string
          organization_id?: string
          pause_feature_updates?: boolean | null
          pause_quality_updates?: boolean | null
          quality_update_deferral?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "windows_update_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "windows_update_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      endpoints_live: {
        Row: {
          agent_secret: string | null
          agent_token: string | null
          agent_version: string | null
          created_at: string | null
          defender_state: Json | null
          defender_state_updated_at: string | null
          defender_version: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          distro: string | null
          distro_version: string | null
          enrolled_at: string | null
          enrolled_via: string | null
          hostname: string | null
          id: string | null
          is_active: boolean | null
          is_online: boolean | null
          isolation_mode: string | null
          kernel_version: string | null
          last_boot_at: string | null
          last_seen_at: string | null
          lsm_status: string | null
          mesh_agent_error: string | null
          mesh_agent_installed_at: string | null
          mesh_agent_state: string | null
          mesh_node_id: string | null
          organization_id: string | null
          os_build: string | null
          os_version: string | null
          policy_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          runtime: string | null
          ssh_config_summary: Json | null
          uac_policy_id: string | null
          unattended_upgrades: boolean | null
          update_channel: string | null
          updated_at: string | null
          uptime_seconds: number | null
          wdac_policy_id: string | null
          windows_update_policy_id: string | null
        }
        Insert: {
          agent_secret?: string | null
          agent_token?: string | null
          agent_version?: string | null
          created_at?: string | null
          defender_state?: Json | null
          defender_state_updated_at?: string | null
          defender_version?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          distro?: string | null
          distro_version?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          hostname?: string | null
          id?: string | null
          is_active?: boolean | null
          is_online?: boolean | null
          isolation_mode?: string | null
          kernel_version?: string | null
          last_boot_at?: string | null
          last_seen_at?: string | null
          lsm_status?: string | null
          mesh_agent_error?: string | null
          mesh_agent_installed_at?: string | null
          mesh_agent_state?: string | null
          mesh_node_id?: string | null
          organization_id?: string | null
          os_build?: string | null
          os_version?: string | null
          policy_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          runtime?: string | null
          ssh_config_summary?: Json | null
          uac_policy_id?: string | null
          unattended_upgrades?: boolean | null
          update_channel?: string | null
          updated_at?: string | null
          uptime_seconds?: number | null
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Update: {
          agent_secret?: string | null
          agent_token?: string | null
          agent_version?: string | null
          created_at?: string | null
          defender_state?: Json | null
          defender_state_updated_at?: string | null
          defender_version?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          distro?: string | null
          distro_version?: string | null
          enrolled_at?: string | null
          enrolled_via?: string | null
          hostname?: string | null
          id?: string | null
          is_active?: boolean | null
          is_online?: boolean | null
          isolation_mode?: string | null
          kernel_version?: string | null
          last_boot_at?: string | null
          last_seen_at?: string | null
          lsm_status?: string | null
          mesh_agent_error?: string | null
          mesh_agent_installed_at?: string | null
          mesh_agent_state?: string | null
          mesh_node_id?: string | null
          organization_id?: string | null
          os_build?: string | null
          os_version?: string | null
          policy_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          runtime?: string | null
          ssh_config_summary?: Json | null
          uac_policy_id?: string | null
          unattended_upgrades?: boolean | null
          update_channel?: string | null
          updated_at?: string | null
          uptime_seconds?: number | null
          wdac_policy_id?: string | null
          windows_update_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoints_deleted_by_fkey"
            columns: ["deleted_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_enrolled_via_fkey"
            columns: ["enrolled_via"]
            referencedRelation: "enrollment_tokens"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "endpoints_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "endpoints_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_policy_id_fkey"
            columns: ["policy_id"]
            referencedRelation: "defender_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_uac_policy_id_fkey"
            columns: ["uac_policy_id"]
            referencedRelation: "uac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_wdac_policy_id_fkey"
            columns: ["wdac_policy_id"]
            referencedRelation: "wdac_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endpoints_windows_update_policy_id_fkey"
            columns: ["windows_update_policy_id"]
            referencedRelation: "windows_update_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      m365_tenants_view: {
        Row: {
          access_token_expires_at: string | null
          connected_by: string | null
          consent_state: string | null
          created_at: string | null
          id: string | null
          last_poll_at: string | null
          last_poll_error: string | null
          organization_id: string | null
          remediation_enabled: boolean | null
          remediation_scopes: string[] | null
          scopes: string[] | null
          tenant_display_name: string | null
          tenant_domain: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_token_expires_at?: string | null
          connected_by?: string | null
          consent_state?: string | null
          created_at?: string | null
          id?: string | null
          last_poll_at?: string | null
          last_poll_error?: string | null
          organization_id?: string | null
          remediation_enabled?: boolean | null
          remediation_scopes?: string[] | null
          scopes?: string[] | null
          tenant_display_name?: string | null
          tenant_domain?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token_expires_at?: string | null
          connected_by?: string | null
          consent_state?: string | null
          created_at?: string | null
          id?: string | null
          last_poll_at?: string | null
          last_poll_error?: string | null
          organization_id?: string | null
          remediation_enabled?: boolean | null
          remediation_scopes?: string[] | null
          scopes?: string[] | null
          tenant_display_name?: string | null
          tenant_domain?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "m365_tenants_connected_by_fkey"
            columns: ["connected_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "m365_tenants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organization_device_quota"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "m365_tenants_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_device_quota: {
        Row: {
          effective_cap: number | null
          organization_id: string | null
          organization_name: string | null
          override: number | null
          partner_child: boolean | null
          plan: Database["public"]["Enums"]["subscription_plan"] | null
          plan_default: number | null
          used: number | null
        }
        Insert: {
          effective_cap?: never
          organization_id?: string | null
          organization_name?: string | null
          override?: number | null
          partner_child?: never
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          plan_default?: never
          used?: never
        }
        Update: {
          effective_cap?: never
          organization_id?: string | null
          organization_name?: string | null
          override?: number | null
          partner_child?: never
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          plan_default?: never
          used?: never
        }
        Relationships: []
      }
    }
    Functions: {
      agent_legacy_upgrade: {
        Args: { p_api_base_url?: string; p_legacy_token: string }
        Returns: {
          out_agent_id: string
          out_agent_secret: string
          out_already_upgraded: boolean
          out_api_base_url: string
        }[]
      }
      ai_soc_budget_remaining_cents: {
        Args: { p_org_id: string }
        Returns: number
      }
      ai_soc_try_lock_org: { Args: { p_org_id: string }; Returns: boolean }
      app_control_state_for_endpoint: {
        Args: { p_endpoint_id: string }
        Returns: Json
      }
      assign_incident: {
        Args: { p_assignee: string; p_incident_id: string }
        Returns: {
          alert_id: string | null
          assigned_at: string | null
          assignee_id: string | null
          created_at: string
          description: string | null
          endpoint_id: string | null
          id: string
          kind: string
          opened_at: string
          organization_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          sla_due_at: string
          status: string
          threat_id: string | null
          title: string
          triaged_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_customer: {
        Args: { p_name: string; p_slug: string }
        Returns: Json
      }
      build_org_period_summary: {
        Args: { p_org: string; p_period_end: string; p_period_start: string }
        Returns: Json
      }
      build_site_period_summary: {
        Args: { p_period_end: string; p_period_start: string; p_site: string }
        Returns: Json
      }
      can_add_device: { Args: { _org_id: string }; Returns: boolean }
      cancel_agent_command: { Args: { p_command_id: string }; Returns: boolean }
      create_default_hardening_profiles: {
        Args: { _org_id: string }
        Returns: undefined
      }
      create_enrollment_token: {
        Args: {
          p_channel?: string
          p_hostname_hint?: string
          p_max_uses?: number
          p_org_id: string
          p_runtime_hint?: string
        }
        Returns: {
          expires_at: string
          max_uses: number
          token: string
        }[]
      }
      drop_old_dns_query_logs_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      drop_old_endpoint_event_log_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      drop_old_endpoint_status_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      drop_old_firewall_audit_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      drop_old_site_event_log_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      drop_old_sysmon_events_partitions: {
        Args: { p_keep?: string }
        Returns: number
      }
      endpoint_app_whitelist_add_observed: {
        Args: { p_endpoint_id: string; p_sha256: string }
        Returns: string
      }
      endpoint_app_whitelist_enforce: {
        Args: { p_endpoint_id: string }
        Returns: {
          audit_started_at: string | null
          endpoint_id: string
          enforce_started_at: string | null
          mode: string
          organization_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "app_whitelist_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_app_whitelist_start_audit: {
        Args: { p_endpoint_id: string }
        Returns: {
          audit_started_at: string | null
          endpoint_id: string
          enforce_started_at: string | null
          mode: string
          organization_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "app_whitelist_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_app_whitelist_stop: {
        Args: { p_endpoint_id: string }
        Returns: {
          audit_started_at: string | null
          endpoint_id: string
          enforce_started_at: string | null
          mode: string
          organization_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "app_whitelist_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_microseg_enforce: {
        Args: { p_direction?: string; p_endpoint_id: string }
        Returns: {
          direction: string
          endpoint_id: string
          enforce_started_at: string | null
          observation_started_at: string | null
          organization_id: string
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "endpoint_microseg_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_microseg_start_learning: {
        Args: { p_direction?: string; p_endpoint_id: string }
        Returns: {
          direction: string
          endpoint_id: string
          enforce_started_at: string | null
          observation_started_at: string | null
          organization_id: string
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "endpoint_microseg_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_microseg_stop: {
        Args: { p_direction?: string; p_endpoint_id: string }
        Returns: {
          direction: string
          endpoint_id: string
          enforce_started_at: string | null
          observation_started_at: string | null
          organization_id: string
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "endpoint_microseg_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      endpoint_restore: { Args: { p_endpoint_id: string }; Returns: boolean }
      endpoint_soft_delete: {
        Args: { p_endpoint_id: string; p_reason?: string }
        Returns: boolean
      }
      enqueue_agent_command: {
        Args: {
          p_command_type: string
          p_endpoint_id: string
          p_incident_id?: string
          p_params?: Json
        }
        Returns: {
          command_type: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          dispatched_at: string | null
          endpoint_id: string
          error_message: string | null
          expires_at: string
          id: string
          incident_id: string | null
          issued_at: string
          issued_by: string | null
          organization_id: string
          params: Json
          result: Json | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_customer_reports: {
        Args: { p_kind: string; p_period_end: string; p_period_start: string }
        Returns: number
      }
      ensure_dns_query_logs_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      ensure_endpoint_event_log_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      ensure_endpoint_status_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      ensure_firewall_audit_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      ensure_site_event_log_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      ensure_sysmon_events_partition: {
        Args: { p_month: string }
        Returns: undefined
      }
      extend_app_control_audit: {
        Args: { p_extra_days: number; p_rule_set_id: string }
        Returns: undefined
      }
      firewall_rule_allow_source: {
        Args: { p_ip: string; p_rule_id: string }
        Returns: {
          action: string
          allowed_source_groups: string[] | null
          allowed_source_ips: string[] | null
          audit_started_at: string
          created_at: string
          direction: string
          enabled: boolean
          endpoint_group_id: string
          id: string
          mode: string
          order_priority: number
          policy_id: string
          port: string
          protocol: string
          service_name: string
        }
        SetofOptions: {
          from: "*"
          to: "firewall_service_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gen_org_slug: { Args: { p_seed: string }; Returns: string }
      get_effective_plan: {
        Args: { _org_id: string }
        Returns: Database["public"]["Enums"]["subscription_plan"]
      }
      get_endpoint_app_whitelist: {
        Args: { p_endpoint_id: string }
        Returns: Json
      }
      get_endpoint_dns_policy: {
        Args: { p_endpoint_id: string }
        Returns: string
      }
      get_endpoint_microseg: {
        Args: { p_direction?: string; p_endpoint_id: string }
        Returns: Json
      }
      get_latest_endpoint_status_ids: { Args: never; Returns: string[] }
      get_microseg_rule_endpoint_breakdown: {
        Args: { p_org_id: string; p_rule_id: string }
        Returns: {
          endpoint_id: string
          hits_7d: number
          hostname: string
          last_seen: string
          top_sources: Json
          unique_sources: number
        }[]
      }
      get_microseg_rule_stats: {
        Args: { p_org_id: string }
        Returns: {
          audit_started_at: string
          hits_24h: number
          hits_7d: number
          hits_by_day: Json
          last_seen: string
          rule_id: string
          top_sources: Json
          unique_endpoints_7d: number
          unique_sources_24h: number
          unique_sources_7d: number
        }[]
      }
      get_microseg_unmatched_traffic: {
        Args: { p_org_id: string; p_top_limit?: number }
        Returns: {
          hits_24h: number
          hits_7d: number
          last_seen: string
          local_port: number
          protocol: string
          sample_service_name: string
          top_sources: Json
          unique_endpoints_7d: number
          unique_sources_24h: number
          unique_sources_7d: number
        }[]
      }
      get_partner_customer_org_ids: {
        Args: { _user_id: string }
        Returns: string[]
      }
      get_router_uptime_stats: {
        Args: { _days?: number; _router_id: string }
        Returns: {
          current_session_start: string
          last_offline_at: string
          last_online_at: string
          total_downtime_minutes: number
          uptime_percent: number
        }[]
      }
      get_user_org_ids: { Args: { _user_id: string }; Returns: string[] }
      is_admin_of_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_member_of_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_partner_admin: { Args: { _user_id: string }; Returns: boolean }
      is_partner_admin_of_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      log_activity: {
        Args: {
          _action: string
          _details?: Json
          _endpoint_id?: string
          _org_id: string
          _resource_id?: string
          _resource_type: string
        }
        Returns: string
      }
      m365_detect_signin_spikes: { Args: never; Returns: number }
      m365_emit_alert: {
        Args: {
          p_alert_type: string
          p_message: string
          p_org_id: string
          p_severity: string
          p_title: string
        }
        Returns: string
      }
      m365_high_risk_scopes: { Args: never; Returns: string[] }
      m365_privileged_role_names: { Args: never; Returns: string[] }
      m365_try_lock_tenant: { Args: { p_id: string }; Returns: boolean }
      org_has_feature: {
        Args: { _feature: string; _org_id: string }
        Returns: boolean
      }
      process_queued_customer_reports: { Args: never; Returns: undefined }
      reconcile_endpoint_threat_status: { Args: never; Returns: number }
      reserve_enrollment_slot: {
        Args: { p_token: string }
        Returns: {
          channel: string
          expires_at: string
          hostname_hint: string
          max_uses: number
          organization_id: string
          runtime_hint: string
          use_count: number
          used_at: string
        }[]
      }
      reserve_site_enrollment_slot: {
        Args: { p_token: string }
        Returns: {
          max_uses: number
          organization_id: string
          use_count: number
        }[]
      }
      resolve_incident: {
        Args: { p_incident_id: string; p_notes?: string; p_outcome?: string }
        Returns: {
          alert_id: string | null
          assigned_at: string | null
          assignee_id: string | null
          created_at: string
          description: string | null
          endpoint_id: string | null
          id: string
          kind: string
          opened_at: string
          organization_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          sla_due_at: string
          status: string
          threat_id: string | null
          title: string
          triaged_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_stale_site_findings: {
        Args: { p_active_keys: string[]; p_site: string }
        Returns: number
      }
      upsert_app_control_state_for_endpoint_rule_set: {
        Args: { p_endpoint_id: string; p_rule_set_id: string }
        Returns: undefined
      }
      use_enrollment_code: {
        Args: { _code: string; _user_id: string }
        Returns: boolean
      }
      validate_enrollment_code: {
        Args: { _code: string }
        Returns: {
          error_message: string
          is_valid: boolean
          organization_id: string
          organization_name: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      mint_router_enrollment_token: {
        Args: {
          p_organization_id: string
          p_label?: string | null
          p_max_uses?: number | null
          p_expires_at?: string | null
        }
        Returns: {
          token_id: string
          plaintext_token: string
        }[]
      }
      reserve_router_enrollment_slot: {
        Args: { p_token: string }
        Returns: {
          organization_id: string
          use_count: number
          max_uses: number
        }[]
      }
      router_heartbeat_by_token: {
        Args: {
          p_token: string
          p_wan_ip?: string | null
          p_firmware_version?: string | null
          p_is_online?: boolean | null
        }
        Returns: {
          id: string
          hostname: string
          organization_id: string
        }[]
      }
    }
    Enums: {
      asr_action: "disabled" | "enabled" | "audit"
      org_role: "owner" | "admin" | "member" | "viewer"
      subscription_plan: "free" | "pro" | "business"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  realtime: {
    Tables: {
      messages: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_01: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_02: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_03: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_04: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_05: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_06: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages_2026_06_07: {
        Row: {
          event: string | null
          extension: string
          id: string
          inserted_at: string
          payload: Json | null
          private: boolean | null
          topic: string
          updated_at: string
        }
        Insert: {
          event?: string | null
          extension: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic: string
          updated_at?: string
        }
        Update: {
          event?: string | null
          extension?: string
          id?: string
          inserted_at?: string
          payload?: Json | null
          private?: boolean | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      schema_migrations: {
        Row: {
          inserted_at: string | null
          version: number
        }
        Insert: {
          inserted_at?: string | null
          version: number
        }
        Update: {
          inserted_at?: string | null
          version?: number
        }
        Relationships: []
      }
      subscription: {
        Row: {
          action_filter: string | null
          claims: Json
          claims_role: unknown
          created_at: string
          entity: unknown
          filters: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id: number
          subscription_id: string
        }
        Insert: {
          action_filter?: string | null
          claims: Json
          claims_role?: unknown
          created_at?: string
          entity: unknown
          filters?: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id?: never
          subscription_id: string
        }
        Update: {
          action_filter?: string | null
          claims?: Json
          claims_role?: unknown
          created_at?: string
          entity?: unknown
          filters?: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
          id?: never
          subscription_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_rls: {
        Args: { max_record_bytes?: number; wal: Json }
        Returns: Database["realtime"]["CompositeTypes"]["wal_rls"][]
        SetofOptions: {
          from: "*"
          to: "wal_rls"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      broadcast_changes: {
        Args: {
          event_name: string
          level?: string
          new: Record<string, unknown>
          old: Record<string, unknown>
          operation: string
          table_name: string
          table_schema: string
          topic_name: string
        }
        Returns: undefined
      }
      build_prepared_statement_sql: {
        Args: {
          columns: Database["realtime"]["CompositeTypes"]["wal_column"][]
          entity: unknown
          prepared_statement_name: string
        }
        Returns: string
      }
      cast: { Args: { type_: unknown; val: string }; Returns: Json }
      check_equality_op: {
        Args: {
          op: Database["realtime"]["Enums"]["equality_op"]
          type_: unknown
          val_1: string
          val_2: string
        }
        Returns: boolean
      }
      is_visible_through_filters: {
        Args: {
          columns: Database["realtime"]["CompositeTypes"]["wal_column"][]
          filters: Database["realtime"]["CompositeTypes"]["user_defined_filter"][]
        }
        Returns: boolean
      }
      list_changes: {
        Args: {
          max_changes: number
          max_record_bytes: number
          publication: unknown
          slot_name: unknown
        }
        Returns: Database["realtime"]["CompositeTypes"]["wal_rls"][]
        SetofOptions: {
          from: "*"
          to: "wal_rls"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      quote_wal2json: { Args: { entity: unknown }; Returns: string }
      send: {
        Args: { event: string; payload: Json; private?: boolean; topic: string }
        Returns: undefined
      }
      to_regrole: { Args: { role_name: string }; Returns: unknown }
      topic: { Args: never; Returns: string }
    }
    Enums: {
      action: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE" | "ERROR"
      equality_op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in"
    }
    CompositeTypes: {
      user_defined_filter: {
        column_name: string | null
        op: Database["realtime"]["Enums"]["equality_op"] | null
        value: string | null
      }
      wal_column: {
        name: string | null
        type_name: string | null
        type_oid: unknown
        value: Json | null
        is_pkey: boolean | null
        is_selectable: boolean | null
      }
      wal_rls: {
        wal: Json | null
        is_rls_enabled: boolean | null
        subscription_ids: string[] | null
        errors: string[] | null
      }
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  supabase_functions: {
    Tables: {
      hooks: {
        Row: {
          created_at: string
          hook_name: string
          hook_table_id: number
          id: number
          request_id: number | null
        }
        Insert: {
          created_at?: string
          hook_name: string
          hook_table_id: number
          id?: number
          request_id?: number | null
        }
        Update: {
          created_at?: string
          hook_name?: string
          hook_table_id?: number
          id?: number
          request_id?: number | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          inserted_at: string
          version: string
        }
        Insert: {
          inserted_at?: string
          version: string
        }
        Update: {
          inserted_at?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  vault: {
    Tables: {
      secrets: {
        Row: {
          created_at: string
          description: string
          id: string
          key_id: string | null
          name: string | null
          nonce: string | null
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      decrypted_secrets: {
        Row: {
          created_at: string | null
          decrypted_secret: string | null
          description: string | null
          id: string | null
          key_id: string | null
          name: string | null
          nonce: string | null
          secret: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          decrypted_secret?: never
          description?: string | null
          id?: string | null
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          decrypted_secret?: never
          description?: string | null
          id?: string | null
          key_id?: string | null
          name?: string | null
          nonce?: string | null
          secret?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _crypto_aead_det_decrypt: {
        Args: {
          additional: string
          context?: string
          key_id: number
          message: string
          nonce?: string
        }
        Returns: string
      }
      _crypto_aead_det_encrypt: {
        Args: {
          additional: string
          context?: string
          key_id: number
          message: string
          nonce?: string
        }
        Returns: string
      }
      _crypto_aead_det_noncegen: { Args: never; Returns: string }
      create_secret: {
        Args: {
          new_description?: string
          new_key_id?: string
          new_name?: string
          new_secret: string
        }
        Returns: string
      }
      update_secret: {
        Args: {
          new_description?: string
          new_key_id?: string
          new_name?: string
          new_secret?: string
          secret_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  _realtime: {
    Enums: {},
  },
  auth: {
    Enums: {
      aal_level: ["aal1", "aal2", "aal3"],
      code_challenge_method: ["s256", "plain"],
      factor_status: ["unverified", "verified"],
      factor_type: ["totp", "webauthn", "phone"],
      oauth_authorization_status: ["pending", "approved", "denied", "expired"],
      oauth_client_type: ["public", "confidential"],
      oauth_registration_type: ["dynamic", "manual"],
      oauth_response_type: ["code"],
      one_time_token_type: [
        "confirmation_token",
        "reauthentication_token",
        "recovery_token",
        "email_change_token_new",
        "email_change_token_current",
        "phone_change_token",
      ],
    },
  },
  cron: {
    Enums: {},
  },
  extensions: {
    Enums: {},
  },
  graphql: {
    Enums: {},
  },
  graphql_public: {
    Enums: {},
  },
  net: {
    Enums: {
      request_status: ["PENDING", "SUCCESS", "ERROR"],
    },
  },
  pgbouncer: {
    Enums: {},
  },
  public: {
    Enums: {
      asr_action: ["disabled", "enabled", "audit"],
      org_role: ["owner", "admin", "member", "viewer"],
      subscription_plan: ["free", "pro", "business"],
    },
  },
  realtime: {
    Enums: {
      action: ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "ERROR"],
      equality_op: ["eq", "neq", "lt", "lte", "gt", "gte", "in"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
  supabase_functions: {
    Enums: {},
  },
  vault: {
    Enums: {},
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      recycling_certificates: {
        Row: {
          bytes: number;
          certificate_number: string;
          created_at: string;
          created_by: string;
          id: string;
          issued_on: string;
          issuer: string;
          mime_type: string;
          organization_id: string;
          panel_count: number | null;
          plant_id: string;
          review_reason: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          revision: number;
          sha256: string;
          status: string;
          storage_path: string;
          title: string;
        };
        Insert: {
          bytes: number;
          certificate_number?: string;
          created_at?: string;
          created_by: string;
          id: string;
          issued_on: string;
          issuer: string;
          mime_type: string;
          organization_id: string;
          panel_count?: number | null;
          plant_id: string;
          review_reason?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          revision?: number;
          sha256: string;
          status?: string;
          storage_path: string;
          title: string;
        };
        Update: {
          bytes?: number;
          certificate_number?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          issued_on?: string;
          issuer?: string;
          mime_type?: string;
          organization_id?: string;
          panel_count?: number | null;
          plant_id?: string;
          review_reason?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          revision?: number;
          sha256?: string;
          status?: string;
          storage_path?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recycling_certificates_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recycling_certificates_plant_id_fkey';
            columns: ['plant_id'];
            isOneToOne: false;
            referencedRelation: 'plants';
            referencedColumns: ['id'];
          },
        ];
      };
      analysis_runs: {
        Row: {
          algorithm_key: string;
          algorithm_version: string;
          created_at: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          input_manifest: Json;
          inspection_id: string;
          organization_id: string;
          requested_at: string;
          requested_by: string | null;
          result_summary: Json | null;
          started_at: string | null;
          status: string;
        };
        Insert: {
          algorithm_key: string;
          algorithm_version: string;
          created_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          input_manifest?: Json;
          inspection_id: string;
          organization_id: string;
          requested_at?: string;
          requested_by?: string | null;
          result_summary?: Json | null;
          started_at?: string | null;
          status?: string;
        };
        Update: {
          algorithm_key?: string;
          algorithm_version?: string;
          created_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          input_manifest?: Json;
          inspection_id?: string;
          organization_id?: string;
          requested_at?: string;
          requested_by?: string | null;
          result_summary?: Json | null;
          started_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'analysis_runs_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'analysis_runs_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_user_id: string | null;
          entity_id: string | null;
          entity_type: string;
          id: number;
          metadata: Json;
          occurred_at: string;
          organization_id: string;
          request_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: never;
          metadata?: Json;
          occurred_at?: string;
          organization_id: string;
          request_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: never;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string;
          request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      calculation_settings: {
        Row: {
          change_reason: string;
          created_at: string;
          created_by: string;
          effective_from: string;
          id: string;
          organization_id: string;
          values: Json;
          version: number;
        };
        Insert: {
          change_reason: string;
          created_at?: string;
          created_by: string;
          effective_from: string;
          id?: string;
          organization_id: string;
          values: Json;
          version: number;
        };
        Update: {
          change_reason?: string;
          created_at?: string;
          created_by?: string;
          effective_from?: string;
          id?: string;
          organization_id?: string;
          values?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'calculation_settings_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      findings: {
        Row: {
          analysis_run_id: string | null;
          created_at: string;
          defect_type: string | null;
          disposition: string;
          expert_note: string | null;
          id: string;
          inspection_id: string;
          kind: string;
          location_label: string | null;
          measurement_source: string | null;
          organization_id: string;
          region: Json | null;
          relative_heat_score: number | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          severity: string;
          source: string;
          source_file_id: string | null;
          temperature_delta_c: number | null;
          temperature_max_c: number | null;
          updated_at: string;
        };
        Insert: {
          analysis_run_id?: string | null;
          created_at?: string;
          defect_type?: string | null;
          disposition?: string;
          expert_note?: string | null;
          id?: string;
          inspection_id: string;
          kind: string;
          location_label?: string | null;
          measurement_source?: string | null;
          organization_id: string;
          region?: Json | null;
          relative_heat_score?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          severity?: string;
          source: string;
          source_file_id?: string | null;
          temperature_delta_c?: number | null;
          temperature_max_c?: number | null;
          updated_at?: string;
        };
        Update: {
          analysis_run_id?: string | null;
          created_at?: string;
          defect_type?: string | null;
          disposition?: string;
          expert_note?: string | null;
          id?: string;
          inspection_id?: string;
          kind?: string;
          location_label?: string | null;
          measurement_source?: string | null;
          organization_id?: string;
          region?: Json | null;
          relative_heat_score?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          severity?: string;
          source?: string;
          source_file_id?: string | null;
          temperature_delta_c?: number | null;
          temperature_max_c?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'findings_analysis_run_id_fkey';
            columns: ['analysis_run_id'];
            isOneToOne: false;
            referencedRelation: 'analysis_runs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'findings_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'findings_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'findings_source_file_id_fkey';
            columns: ['source_file_id'];
            isOneToOne: false;
            referencedRelation: 'inspection_files';
            referencedColumns: ['id'];
          },
        ];
      };
      inspection_assessments: {
        Row: {
          calculation_input: Json;
          capture: Json;
          exception_approved_by: string | null;
          exception_reason: string | null;
          inspection_id: string;
          organization_id: string;
          result: Json;
          revision: number;
          settings_id: string;
          updated_at: string;
          updated_by: string;
          warnings: Json;
        };
        Insert: {
          calculation_input: Json;
          capture: Json;
          exception_approved_by?: string | null;
          exception_reason?: string | null;
          inspection_id: string;
          organization_id: string;
          result: Json;
          revision: number;
          settings_id: string;
          updated_at?: string;
          updated_by: string;
          warnings: Json;
        };
        Update: {
          calculation_input?: Json;
          capture?: Json;
          exception_approved_by?: string | null;
          exception_reason?: string | null;
          inspection_id?: string;
          organization_id?: string;
          result?: Json;
          revision?: number;
          settings_id?: string;
          updated_at?: string;
          updated_by?: string;
          warnings?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'inspection_assessments_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: true;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inspection_assessments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inspection_assessments_settings_id_fkey';
            columns: ['settings_id'];
            isOneToOne: false;
            referencedRelation: 'calculation_settings';
            referencedColumns: ['id'];
          },
        ];
      };
      inspection_files: {
        Row: {
          bytes: number | null;
          capture_timezone: string;
          captured_at: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          inspection_id: string;
          kind: string;
          mime_type: string | null;
          organization_id: string;
          original_name: string;
          paired_file_id: string | null;
          quality_status: string;
          sha256: string | null;
          storage_bucket: string;
          storage_path: string;
        };
        Insert: {
          bytes?: number | null;
          capture_timezone?: string;
          captured_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inspection_id: string;
          kind: string;
          mime_type?: string | null;
          organization_id: string;
          original_name: string;
          paired_file_id?: string | null;
          quality_status?: string;
          sha256?: string | null;
          storage_bucket: string;
          storage_path: string;
        };
        Update: {
          bytes?: number | null;
          capture_timezone?: string;
          captured_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inspection_id?: string;
          kind?: string;
          mime_type?: string | null;
          organization_id?: string;
          original_name?: string;
          paired_file_id?: string | null;
          quality_status?: string;
          sha256?: string | null;
          storage_bucket?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inspection_files_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inspection_files_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inspection_files_paired_file_id_fkey';
            columns: ['paired_file_id'];
            isOneToOne: false;
            referencedRelation: 'inspection_files';
            referencedColumns: ['id'];
          },
        ];
      };
      inspections: {
        Row: {
          assigned_expert_user_id: string | null;
          assigned_field_user_id: string | null;
          capture_timezone: string;
          created_at: string;
          created_by: string | null;
          due_at: string | null;
          id: string;
          inspection_code: string;
          notes: string | null;
          organization_id: string;
          plant_id: string;
          purpose: string | null;
          requested_on: string;
          scheduled_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          assigned_expert_user_id?: string | null;
          assigned_field_user_id?: string | null;
          capture_timezone?: string;
          created_at?: string;
          created_by?: string | null;
          due_at?: string | null;
          id?: string;
          inspection_code: string;
          notes?: string | null;
          organization_id: string;
          plant_id: string;
          purpose?: string | null;
          requested_on?: string;
          scheduled_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          assigned_expert_user_id?: string | null;
          assigned_field_user_id?: string | null;
          capture_timezone?: string;
          created_at?: string;
          created_by?: string | null;
          due_at?: string | null;
          id?: string;
          inspection_code?: string;
          notes?: string | null;
          organization_id?: string;
          plant_id?: string;
          purpose?: string | null;
          requested_on?: string;
          scheduled_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inspections_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inspections_plant_id_fkey';
            columns: ['plant_id'];
            isOneToOne: false;
            referencedRelation: 'plants';
            referencedColumns: ['id'];
          },
        ];
      };
      maintenance_requests: {
        Row: {
          assignee_user_id: string | null;
          completed_at: string | null;
          completion_note: string | null;
          created_at: string;
          created_by: string | null;
          finding_id: string | null;
          id: string;
          inspection_id: string;
          organization_id: string;
          priority: string;
          scheduled_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          vendor_name: string | null;
        };
        Insert: {
          assignee_user_id?: string | null;
          completed_at?: string | null;
          completion_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          finding_id?: string | null;
          id?: string;
          inspection_id: string;
          organization_id: string;
          priority?: string;
          scheduled_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Update: {
          assignee_user_id?: string | null;
          completed_at?: string | null;
          completion_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          finding_id?: string | null;
          id?: string;
          inspection_id?: string;
          organization_id?: string;
          priority?: string;
          scheduled_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'maintenance_requests_finding_id_fkey';
            columns: ['finding_id'];
            isOneToOne: false;
            referencedRelation: 'findings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'maintenance_requests_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'maintenance_requests_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          joined_at: string | null;
          organization_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          joined_at?: string | null;
          organization_id: string;
          role: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          joined_at?: string | null;
          organization_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          default_timezone: string;
          id: string;
          is_primary_operator: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_timezone?: string;
          id?: string;
          is_primary_operator?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_timezone?: string;
          id?: string;
          is_primary_operator?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      partner_private_details: {
        Row: {
          business_registration_number: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          license_registration_number: string | null;
          notes: string | null;
          partner_id: string;
          updated_at: string;
        };
        Insert: {
          business_registration_number?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          license_registration_number?: string | null;
          notes?: string | null;
          partner_id: string;
          updated_at?: string;
        };
        Update: {
          business_registration_number?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          license_registration_number?: string | null;
          notes?: string | null;
          partner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_private_details_partner_id_fkey';
            columns: ['partner_id'];
            isOneToOne: true;
            referencedRelation: 'partners';
            referencedColumns: ['id'];
          },
        ];
      };
      partner_quotes: {
        Row: {
          amount_krw: number | null;
          commission_amount_krw: number | null;
          commission_rate: number;
          conditions: string | null;
          created_at: string;
          created_by: string | null;
          estimated_days: number | null;
          id: string;
          organization_id: string;
          partner_id: string;
          proposed_start_on: string | null;
          quote_request_id: string;
          requested_at: string | null;
          scope: string | null;
          selected_at: string | null;
          status: string;
          submitted_at: string | null;
          submitted_by: string | null;
          updated_at: string;
          valid_until: string | null;
        };
        Insert: {
          amount_krw?: number | null;
          commission_amount_krw?: number | null;
          commission_rate?: number;
          conditions?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_days?: number | null;
          id?: string;
          organization_id: string;
          partner_id: string;
          proposed_start_on?: string | null;
          quote_request_id: string;
          requested_at?: string | null;
          scope?: string | null;
          selected_at?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          valid_until?: string | null;
        };
        Update: {
          amount_krw?: number | null;
          commission_amount_krw?: number | null;
          commission_rate?: number;
          conditions?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimated_days?: number | null;
          id?: string;
          organization_id?: string;
          partner_id?: string;
          proposed_start_on?: string | null;
          quote_request_id?: string;
          requested_at?: string | null;
          scope?: string | null;
          selected_at?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_quotes_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_quotes_partner_id_fkey';
            columns: ['partner_id'];
            isOneToOne: false;
            referencedRelation: 'partners';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'partner_quotes_quote_request_id_fkey';
            columns: ['quote_request_id'];
            isOneToOne: false;
            referencedRelation: 'quote_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      partner_users: {
        Row: {
          created_at: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          partner_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          partner_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          partner_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'partner_users_partner_id_fkey';
            columns: ['partner_id'];
            isOneToOne: false;
            referencedRelation: 'partners';
            referencedColumns: ['id'];
          },
        ];
      };
      partners: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          organization_id: string;
          partner_type: string;
          rating: number | null;
          service_regions: string[];
          status: string;
          transaction_count: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          partner_type: string;
          rating?: number | null;
          service_regions?: string[];
          status?: string;
          transaction_count?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          partner_type?: string;
          rating?: number | null;
          service_regions?: string[];
          status?: string;
          transaction_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'partners_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      plant_requesters: {
        Row: {
          created_at: string;
          created_by: string | null;
          plant_id: string;
          requester_user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          plant_id: string;
          requester_user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          plant_id?: string;
          requester_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plant_requesters_plant_id_fkey';
            columns: ['plant_id'];
            isOneToOne: false;
            referencedRelation: 'plants';
            referencedColumns: ['id'];
          },
        ];
      };
      plants: {
        Row: {
          address: string | null;
          capacity_kw: number | null;
          code: string | null;
          commissioned_on: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          name: string;
          organization_id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          capacity_kw?: number | null;
          code?: string | null;
          commissioned_on?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          name: string;
          organization_id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          capacity_kw?: number | null;
          code?: string | null;
          commissioned_on?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          name?: string;
          organization_id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plants_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          email: string | null;
          phone: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          email?: string | null;
          phone?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          email?: string | null;
          phone?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      quote_request_findings: {
        Row: {
          created_at: string;
          finding_id: string;
          quote_request_id: string;
        };
        Insert: {
          created_at?: string;
          finding_id: string;
          quote_request_id: string;
        };
        Update: {
          created_at?: string;
          finding_id?: string;
          quote_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_request_findings_finding_id_fkey';
            columns: ['finding_id'];
            isOneToOne: false;
            referencedRelation: 'findings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_request_findings_quote_request_id_fkey';
            columns: ['quote_request_id'];
            isOneToOne: false;
            referencedRelation: 'quote_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      quote_requests: {
        Row: {
          created_at: string;
          id: string;
          inspection_id: string | null;
          maintenance_request_id: string | null;
          organization_id: string;
          plant_id: string;
          request_code: string;
          requested_at: string | null;
          requested_by: string | null;
          requester_user_id: string;
          response_due_at: string | null;
          scope_summary: string | null;
          selected_quote_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          inspection_id?: string | null;
          maintenance_request_id?: string | null;
          organization_id: string;
          plant_id: string;
          request_code: string;
          requested_at?: string | null;
          requested_by?: string | null;
          requester_user_id: string;
          response_due_at?: string | null;
          scope_summary?: string | null;
          selected_quote_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          inspection_id?: string | null;
          maintenance_request_id?: string | null;
          organization_id?: string;
          plant_id?: string;
          request_code?: string;
          requested_at?: string | null;
          requested_by?: string | null;
          requester_user_id?: string;
          response_due_at?: string | null;
          scope_summary?: string | null;
          selected_quote_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_requests_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_requests_maintenance_request_id_fkey';
            columns: ['maintenance_request_id'];
            isOneToOne: false;
            referencedRelation: 'maintenance_requests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_requests_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_requests_plant_id_fkey';
            columns: ['plant_id'];
            isOneToOne: false;
            referencedRelation: 'plants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_requests_selected_quote_id_fkey';
            columns: ['selected_quote_id'];
            isOneToOne: false;
            referencedRelation: 'partner_quotes';
            referencedColumns: ['id'];
          },
        ];
      };
      report_documents: {
        Row: {
          bytes: number;
          created_at: string;
          created_by: string;
          pdf_sha256: string;
          renderer_version: string;
          report_id: string;
          snapshot_sha256: string;
          storage_path: string;
        };
        Insert: {
          bytes: number;
          created_at?: string;
          created_by: string;
          pdf_sha256: string;
          renderer_version: string;
          report_id: string;
          snapshot_sha256: string;
          storage_path: string;
        };
        Update: {
          bytes?: number;
          created_at?: string;
          created_by?: string;
          pdf_sha256?: string;
          renderer_version?: string;
          report_id?: string;
          snapshot_sha256?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'report_documents_report_id_fkey';
            columns: ['report_id'];
            isOneToOne: false;
            referencedRelation: 'reports';
            referencedColumns: ['id'];
          },
        ];
      };
      report_images: {
        Row: {
          bytes: number;
          caption: string;
          created_at: string;
          created_by: string;
          height: number;
          id: string;
          inspection_id: string;
          masks: Json;
          organization_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sha256: string;
          source_file_id: string;
          status: string;
          storage_path: string;
          width: number;
        };
        Insert: {
          bytes: number;
          caption: string;
          created_at?: string;
          created_by: string;
          height: number;
          id: string;
          inspection_id: string;
          masks?: Json;
          organization_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sha256: string;
          source_file_id: string;
          status?: string;
          storage_path: string;
          width: number;
        };
        Update: {
          bytes?: number;
          caption?: string;
          created_at?: string;
          created_by?: string;
          height?: number;
          id?: string;
          inspection_id?: string;
          masks?: Json;
          organization_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sha256?: string;
          source_file_id?: string;
          status?: string;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'report_images_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'report_images_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'report_images_source_file_id_fkey';
            columns: ['source_file_id'];
            isOneToOne: false;
            referencedRelation: 'inspection_files';
            referencedColumns: ['id'];
          },
        ];
      };
      report_snapshots: {
        Row: {
          content: Json;
          frozen_at: string;
          frozen_by: string;
          organization_id: string;
          report_id: string;
          schema_version: number;
          sha256: string;
        };
        Insert: {
          content: Json;
          frozen_at?: string;
          frozen_by: string;
          organization_id: string;
          report_id: string;
          schema_version?: number;
          sha256: string;
        };
        Update: {
          content?: Json;
          frozen_at?: string;
          frozen_by?: string;
          organization_id?: string;
          report_id?: string;
          schema_version?: number;
          sha256?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'report_snapshots_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'report_snapshots_report_id_fkey';
            columns: ['report_id'];
            isOneToOne: true;
            referencedRelation: 'reports';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          inspection_id: string;
          organization_id: string;
          published_at: string | null;
          status: string;
          storage_bucket: string | null;
          storage_path: string | null;
          title: string;
          updated_at: string;
          version: number;
          withdrawn_at: string | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inspection_id: string;
          organization_id: string;
          published_at?: string | null;
          status?: string;
          storage_bucket?: string | null;
          storage_path?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
          withdrawn_at?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inspection_id?: string;
          organization_id?: string;
          published_at?: string | null;
          status?: string;
          storage_bucket?: string | null;
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_organization_member_by_email: {
        Args: { p_email: string; p_organization_id: string; p_role: string };
        Returns: {
          email: string;
          member_role: string;
          user_id: string;
        }[];
      };
      admin_update_member: {
        Args: {
          p_organization_id: string;
          p_role: string;
          p_status: string;
          p_user_id: string;
        };
        Returns: {
          created_at: string;
          joined_at: string | null;
          organization_id: string;
          role: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'organization_members';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      archive_report_pdf: {
        Args: {
          p_bytes: number;
          p_pdf_sha256: string;
          p_renderer_version: string;
          p_report_id: string;
          p_snapshot_sha256: string;
        };
        Returns: {
          bytes: number;
          created_at: string;
          created_by: string;
          pdf_sha256: string;
          renderer_version: string;
          report_id: string;
          snapshot_sha256: string;
          storage_path: string;
        };
        SetofOptions: {
          from: '*';
          to: 'report_documents';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assign_requester_to_plant: {
        Args: { p_plant_id: string; p_requester_user_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          plant_id: string;
          requester_user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'plant_requesters';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      bootstrap_organization: {
        Args: { p_name: string; p_setup_code: string; p_slug: string };
        Returns: {
          member_role: string;
          organization_id: string;
          organization_name: string;
        }[];
      };
      complete_relative_analysis: {
        Args: {
          p_analysis_run_id: string;
          p_regions: Json;
          p_result_summary: Json;
        };
        Returns: {
          algorithm_key: string;
          algorithm_version: string;
          created_at: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          input_manifest: Json;
          inspection_id: string;
          organization_id: string;
          requested_at: string;
          requested_by: string | null;
          result_summary: Json | null;
          started_at: string | null;
          status: string;
        };
        SetofOptions: {
          from: '*';
          to: 'analysis_runs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_quote_request_with_partners: {
        Args: {
          p_commission_rate?: number;
          p_inspection_id?: string | null;
          p_maintenance_request_id?: string | null;
          p_partner_ids: string[];
          p_plant_id: string;
          p_requester_user_id: string;
          p_response_due_at: string | null;
          p_scope_summary: string;
          p_title: string;
        };
        Returns: {
          created_at: string;
          id: string;
          inspection_id: string | null;
          maintenance_request_id: string | null;
          organization_id: string;
          plant_id: string;
          request_code: string;
          requested_at: string | null;
          requested_by: string | null;
          requester_user_id: string;
          response_due_at: string | null;
          scope_summary: string | null;
          selected_quote_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'quote_requests';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_report_draft: {
        Args: { p_inspection_id: string; p_title: string };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          inspection_id: string;
          organization_id: string;
          published_at: string | null;
          status: string;
          storage_bucket: string | null;
          storage_path: string | null;
          title: string;
          updated_at: string;
          version: number;
          withdrawn_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'reports';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_requester_plant: {
        Args: {
          p_address: string;
          p_capacity_kw: number;
          p_commissioned_on: string;
          p_name: string;
        };
        Returns: {
          address: string | null;
          capacity_kw: number | null;
          code: string | null;
          commissioned_on: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          name: string;
          organization_id: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'plants';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_requester_plant_with_details: {
        Args: {
          p_address: string;
          p_capacity_kw: number;
          p_commissioned_on: string;
          p_data_use_consent: boolean;
          p_inverter_model: string;
          p_module_model: string;
          p_name: string;
          p_operator_type: string;
        };
        Returns: {
          address: string | null;
          capacity_kw: number | null;
          code: string | null;
          commissioned_on: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          name: string;
          organization_id: string;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'plants';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      fail_relative_analysis: {
        Args: { p_analysis_run_id: string; p_message: string };
        Returns: {
          algorithm_key: string;
          algorithm_version: string;
          created_at: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          input_manifest: Json;
          inspection_id: string;
          organization_id: string;
          requested_at: string;
          requested_by: string | null;
          result_summary: Json | null;
          started_at: string | null;
          status: string;
        };
        SetofOptions: {
          from: '*';
          to: 'analysis_runs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      record_partner_quote_response: {
        Args: {
          p_amount_krw: number;
          p_commission_rate: number;
          p_conditions: string;
          p_estimated_days: number | null;
          p_proposed_start_on: string | null;
          p_quote_id: string;
          p_scope: string;
          p_valid_until: string | null;
        };
        Returns: {
          amount_krw: number | null;
          commission_amount_krw: number | null;
          commission_rate: number;
          conditions: string | null;
          created_at: string;
          created_by: string | null;
          estimated_days: number | null;
          id: string;
          organization_id: string;
          partner_id: string;
          proposed_start_on: string | null;
          quote_request_id: string;
          requested_at: string | null;
          scope: string | null;
          selected_at: string | null;
          status: string;
          submitted_at: string | null;
          submitted_by: string | null;
          updated_at: string;
          valid_until: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'partner_quotes';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      correct_recycling_certificate: {
        Args: {
          p_id: string;
          p_issued_on: string;
          p_issuer: string;
          p_number: string;
          p_panel_count: number | null;
          p_plant_id: string;
          p_reason: string;
          p_revision: number;
          p_title: string;
        };
        Returns: {
          bytes: number;
          certificate_number: string;
          created_at: string;
          created_by: string;
          id: string;
          issued_on: string;
          issuer: string;
          mime_type: string;
          organization_id: string;
          panel_count: number | null;
          plant_id: string;
          review_reason: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          revision: number;
          sha256: string;
          status: string;
          storage_path: string;
          title: string;
        };
        SetofOptions: {
          from: '*';
          to: 'recycling_certificates';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_recycling_certificate: {
        Args: {
          p_bytes: number;
          p_id: string;
          p_issued_on: string;
          p_issuer: string;
          p_mime_type: string;
          p_number: string;
          p_panel_count: number | null;
          p_plant_id: string;
          p_sha256: string;
          p_title: string;
        };
        Returns: {
          bytes: number;
          certificate_number: string;
          created_at: string;
          created_by: string;
          id: string;
          issued_on: string;
          issuer: string;
          mime_type: string;
          organization_id: string;
          panel_count: number | null;
          plant_id: string;
          review_reason: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          revision: number;
          sha256: string;
          status: string;
          storage_path: string;
          title: string;
        };
        SetofOptions: {
          from: '*';
          to: 'recycling_certificates';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_report_image: {
        Args: {
          p_bytes: number;
          p_caption: string;
          p_height: number;
          p_id: string;
          p_masks: Json;
          p_sha256: string;
          p_source_file_id: string;
          p_width: number;
        };
        Returns: {
          bytes: number;
          caption: string;
          created_at: string;
          created_by: string;
          height: number;
          id: string;
          inspection_id: string;
          masks: Json;
          organization_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sha256: string;
          source_file_id: string;
          status: string;
          storage_path: string;
          width: number;
        };
        SetofOptions: {
          from: '*';
          to: 'report_images';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_requester: {
        Args: never;
        Returns: {
          member_role: string;
          organization_id: string;
          organization_name: string;
        }[];
      };
      request_inspection: {
        Args: { p_notes: string; p_plant_id: string; p_purpose: string };
        Returns: {
          assigned_expert_user_id: string | null;
          assigned_field_user_id: string | null;
          capture_timezone: string;
          created_at: string;
          created_by: string | null;
          due_at: string | null;
          id: string;
          inspection_code: string;
          notes: string | null;
          organization_id: string;
          plant_id: string;
          purpose: string | null;
          requested_on: string;
          scheduled_at: string | null;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'inspections';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_recycling_certificate: {
        Args: {
          p_id: string;
          p_publish: boolean;
          p_reason: string;
          p_revision: number;
          p_sha256: string;
        };
        Returns: {
          bytes: number;
          certificate_number: string;
          created_at: string;
          created_by: string;
          id: string;
          issued_on: string;
          issuer: string;
          mime_type: string;
          organization_id: string;
          panel_count: number | null;
          plant_id: string;
          review_reason: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          revision: number;
          sha256: string;
          status: string;
          storage_path: string;
          title: string;
        };
        SetofOptions: {
          from: '*';
          to: 'recycling_certificates';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_report_image: {
        Args: { p_approve: boolean; p_id: string; p_sha256: string };
        Returns: {
          bytes: number;
          caption: string;
          created_at: string;
          created_by: string;
          height: number;
          id: string;
          inspection_id: string;
          masks: Json;
          organization_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sha256: string;
          source_file_id: string;
          status: string;
          storage_path: string;
          width: number;
        };
        SetofOptions: {
          from: '*';
          to: 'report_images';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_calculation_settings: {
        Args: {
          p_effective_from: string;
          p_organization_id: string;
          p_reason: string;
          p_values: Json;
        };
        Returns: {
          change_reason: string;
          created_at: string;
          created_by: string;
          effective_from: string;
          id: string;
          organization_id: string;
          values: Json;
          version: number;
        };
        SetofOptions: {
          from: '*';
          to: 'calculation_settings';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_inspection_assessment: {
        Args: {
          p_capture: Json;
          p_exception_reason: string;
          p_expected_revision: number;
          p_input: Json;
          p_inspection_id: string;
          p_settings_id: string;
        };
        Returns: {
          calculation_input: Json;
          capture: Json;
          exception_approved_by: string | null;
          exception_reason: string | null;
          inspection_id: string;
          organization_id: string;
          result: Json;
          revision: number;
          settings_id: string;
          updated_at: string;
          updated_by: string;
          warnings: Json;
        };
        SetofOptions: {
          from: '*';
          to: 'inspection_assessments';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_partner_profile: {
        Args: {
          p_business_registration_number: string;
          p_contact_email: string;
          p_contact_name: string;
          p_contact_phone: string;
          p_license_registration_number: string;
          p_name: string;
          p_notes: string;
          p_organization_id: string;
          p_partner_id: string | null;
          p_partner_type: string;
          p_rating: number | null;
          p_service_regions: string[];
          p_status: string;
        };
        Returns: string;
      };
      select_partner_quote: {
        Args: { p_quote_id: string };
        Returns: {
          amount_krw: number | null;
          commission_amount_krw: number | null;
          commission_rate: number;
          conditions: string | null;
          created_at: string;
          created_by: string | null;
          estimated_days: number | null;
          id: string;
          organization_id: string;
          partner_id: string;
          proposed_start_on: string | null;
          quote_request_id: string;
          requested_at: string | null;
          scope: string | null;
          selected_at: string | null;
          status: string;
          submitted_at: string | null;
          submitted_by: string | null;
          updated_at: string;
          valid_until: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'partner_quotes';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      start_relative_analysis: {
        Args: { p_inspection_file_id: string; p_normalized_pixels: number };
        Returns: {
          algorithm_key: string;
          algorithm_version: string;
          created_at: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          input_manifest: Json;
          inspection_id: string;
          organization_id: string;
          requested_at: string;
          requested_by: string | null;
          result_summary: Json | null;
          started_at: string | null;
          status: string;
        };
        SetofOptions: {
          from: '*';
          to: 'analysis_runs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      transition_report_status: {
        Args: {
          p_next_status: string;
          p_reason?: string | null;
          p_report_id: string;
        };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          inspection_id: string;
          organization_id: string;
          published_at: string | null;
          status: string;
          storage_bucket: string | null;
          storage_path: string | null;
          title: string;
          updated_at: string;
          version: number;
          withdrawn_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'reports';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
